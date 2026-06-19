import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

async function streamToBase64(body) {
  const reader = body.getReader();
  const base64Chunks = [];
  let leftover = new Uint8Array(0);
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const combined = new Uint8Array(leftover.length + value.length);
    combined.set(leftover);
    combined.set(value, leftover.length);
    const remainder = combined.length % 3;
    const processLen = combined.length - remainder;
    if (processLen > 0) {
      let binary = '';
      const view = combined.subarray(0, processLen);
      for (let j = 0; j < view.length; j++) binary += String.fromCharCode(view[j]);
      base64Chunks.push(btoa(binary));
    }
    leftover = combined.slice(processLen);
  }
  if (leftover.length > 0) {
    let binary = '';
    for (let j = 0; j < leftover.length; j++) binary += String.fromCharCode(leftover[j]);
    base64Chunks.push(btoa(binary));
  }
  return base64Chunks.join('');
}

async function fetchFileBlock(url, i) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const contentType = res.headers.get('content-type') || '';
  const lower = url.toLowerCase().split('?')[0];
  const isBinary = /\.(png|jpg|jpeg|gif|webp)$/i.test(lower) || contentType.startsWith('image/') || contentType === 'application/pdf' || lower.includes('.pdf');

  if (isBinary) {
    const base64 = await streamToBase64(res.body);
    if (/\.(png|jpg|jpeg|gif|webp)$/i.test(lower) || contentType.startsWith('image/')) {
      const mt = contentType.includes('png') ? 'image/png' : contentType.includes('webp') ? 'image/webp' : contentType.includes('gif') ? 'image/gif' : 'image/jpeg';
      return { type: 'image', source: { type: 'base64', media_type: mt, data: base64 } };
    }
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
  }

  const buffer = await res.arrayBuffer();
  return { type: 'text', text: `[Arquivo ${i + 1}]\n${new TextDecoder().decode(buffer).substring(0, 8000)}` };
}

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const { fileUrls = [], anamnesis = '' } = body;
    if (!fileUrls.length) return Response.json({ error: 'Nenhum arquivo' }, { status: 400 });

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return Response.json({ error: 'API key não configurada' }, { status: 500 });

    const base44 = createClientFromRequest(req);
    const [surgeries, examLimits] = await Promise.all([
      base44.asServiceRole.entities.Surgery.list(),
      base44.asServiceRole.entities.ExamLimit.list()
    ]);

const systemPrompt = `Médico anestesista — triagem pré-operatória para cirurgia plástica eletiva. SEJA DIRETO, CONCISO, SEM PROLIXIDADE.

CIRURGIAS:
${surgeries.map(s => `- ${s.name}: ${(s.required_exams || []).join(', ')}`).join('\n')}

Combinadas = todos os exames de todos os procedimentos.

REGRAS:
- Hb ≥ 12. < 12 = alteração relevante.
- PCR > 10 = alterada. ≤ 10 ok.
- BIRADS 1-2 ok. 3-6 = mastologista + parecer (sem = 🚨 CRÍTICO).
- Nódulo RX tórax = pneumologista.
- GLP-1 = suspender 21d.
- ECG: FC ≥ 50 isolada ok. Avaliar bloqueios, arritmias, isquemia.
- Urina: só sinalizar se ITU. Ignorar flora/células/muco.
- Ilegível = ❓. NUNCA inventar.
- Não enviado = ❌.

LIMITES:
${examLimits.map(l => `- ${l.exam_name}: ${l.description}${l.unit ? ' (' + l.unit + ')' : ''}`).join('\n')}

FORMATO: output_triage. Resposta ultra-compacta. blocoResumo = texto único pronto para WhatsApp.`;

    const blocks = await Promise.all(fileUrls.map((url, i) => fetchFileBlock(url, i)));

    const content = [];
    const isSinglePdf = fileUrls.length === 1;
    content.push({ type: 'text', text: `${isSinglePdf ? '⚠️ Arquivo único: LEIA TODAS AS PÁGINAS — pode conter múltiplos exames dentro do PDF.\n\n' : ''}Analise ${fileUrls.length} arquivo(s).${anamnesis.trim() ? ' Anamnese: ' + anamnesis.substring(0, 500) : ''}\n\nExtraia CADA exame individualmente. Confira valores, unidade e data. Devolva via output_triage. Direto e conciso.` });

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (!b) {
        content.push({ type: 'text', text: `--- EXAME [${i + 1}]: indisponível ---` });
      } else {
        content.push({ type: 'text', text: `--- EXAME [${i + 1}] ---` });
        content.push(b);
      }
    }

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3072,
        system: systemPrompt,
        messages: [{ role: 'user', content }],
        tools: [{
          name: 'output_triage',
          description: 'Triagem pré-anestésica',
          input_schema: {
            type: 'object',
            properties: {
              patientName: { type: 'string' },
              patientInfo: { type: 'string' },
              surgeryType: { type: 'string' },
              examResults: { type: 'array', items: { type: 'object', properties: { exam: { type: 'string' }, status: { type: 'string', description: '✅/⚠️/❌/❓' }, value: { type: 'string' } }, required: ['exam', 'status', 'value'] } },
              alerts: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', description: '❌/⚠️/ℹ️' }, text: { type: 'string' } }, required: ['severity', 'text'] } },
              missingExams: { type: 'array', items: { type: 'string' } },
              alteredExams: { type: 'array', items: { type: 'string' } },
              finalStatus: { type: 'string' },
              conduct: { type: 'string' },
              blocoResumo: { type: 'string' }
            },
            required: ['patientName', 'surgeryType', 'finalStatus', 'examResults', 'blocoResumo']
          }
        }],
        tool_choice: { type: 'tool', name: 'output_triage' }
      })
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      return Response.json({ error: `Erro Claude (${claudeRes.status}): ${err.substring(0, 300)}` }, { status: 500 });
    }

    const data = await claudeRes.json();
    const toolBlock = (data.content || []).find(c => c.type === 'tool_use' && c.name === 'output_triage');
    
    if (!toolBlock || !toolBlock.input) {
      const text = (data.content || []).map(c => c.text || '').join(' ').substring(0, 500);
      return Response.json({ error: `IA não retornou dados estruturados. Resposta: ${text}` }, { status: 500 });
    }

    const parsed = toolBlock.input;

    let status = 'incomplete';
    const fs = parsed.finalStatus || '';
    if (fs.includes('crítica') || fs.includes('🚨')) status = 'critical_pending';
    else if (fs.includes('sem alertas') || fs.includes('✅')) status = 'complete_without_alerts';
    else if (fs.includes('com alertas') || fs.includes('⚠️')) status = 'complete_with_alerts';

    await base44.asServiceRole.entities.Triage.create({
      patient_name: parsed.patientName,
      surgery_type: parsed.surgeryType || 'indefinida',
      status,
      missing_exams: parsed.missingExams || [],
      altered_exams: parsed.alteredExams || [],
      relatorio_tecnico: '',
      bloco_resumo: parsed.blocoResumo || '',
      files_count: fileUrls.length
    });

    return Response.json({
      patientName: parsed.patientName,
      patientInfo: parsed.patientInfo || '',
      surgeryType: parsed.surgeryType || 'indefinida',
      examResults: parsed.examResults || [],
      alerts: parsed.alerts || [],
      missingExams: parsed.missingExams || [],
      alteredExams: parsed.alteredExams || [],
      finalStatus: parsed.finalStatus || '❌ Pendente',
      conduct: parsed.conduct || '',
      blocoResumo: parsed.blocoResumo || '',
      relatorioTecnico: '',
      status
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Erro interno.' }, { status: 500 });
  }
});