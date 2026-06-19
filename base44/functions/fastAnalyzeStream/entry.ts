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

    const systemPrompt = `Você é um médico anestesista experiente fazendo avaliação pré-operatória de triagem.

## CIRURGIAS CADASTRADAS
${surgeries.map(s => `- **${s.name}** → key: "${s.key}" | Exames obrigatórios: ${(s.required_exams || []).join(', ')}`).join('\n')}

## LIMITES CLÍNICOS DE REFERÊNCIA
${examLimits.map(l => {
  let line = `- **${l.exam_name}**: ${l.description}`;
  if (l.unit) line += ` (${l.unit})`;
  if (l.min_value != null && l.max_value != null) line += ` → ${l.min_value}–${l.max_value} ${l.unit || ''}`;
  else if (l.min_value != null) line += ` → ≥ ${l.min_value} ${l.unit || ''}`;
  else if (l.max_value != null) line += ` → ≤ ${l.max_value} ${l.unit || ''}`;
  if (l.notes) line += `. Obs: ${l.notes}`;
  return line;
}).join('\n')}

## REGRAS CLÍNICAS
- Mama/BIRADS: 1-2 ok. 3-6 → encaminhar mastologista + parecer. Sem parecer = 🚨 pendência crítica.
- RX tórax: nódulo → pneumologista obrigatório.
- Anti-HBs < 2 não contraindica — apenas informe.
- GLP-1: suspender 21 dias antes da cirurgia.
- Avaliar anticoagulantes, antiagregantes, anticoncepcionais, hipoglicemiantes, corticoides, imunossupressores, psicotrópicos.
- Ilegível/cortado/desfocado: "❓ Ilegível". NUNCA invente.
- Exame obrigatório não enviado → "❌ Não enviado".
- PROIBIDO: inventar resultados, presumir BIRADS, ignorar Hb<12, ignorar nódulo, liberar sem exames obrigatórios.
- Em dúvida → interpretação conservadora.`;

    // Baixar arquivos
    const blocks = await Promise.all(fileUrls.map((url, i) => fetchFileBlock(url, i)));

    const content = [];
    content.push({ type: 'text', text: `Analise TODOS os ${fileUrls.length} exames anexados como médico anestesista.${anamnesis.trim() ? '\n\nANAMNESE:\n' + anamnesis : ''}\n\nIdentifique paciente, cirurgia, compare com os limites de referência, verifique completude dos exames obrigatórios. Use a função output_triage para retornar o resultado.` });

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
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content }],
        tools: [{
          name: 'output_triage',
          description: 'Retorna o resultado completo da triagem pré-anestésica',
          input_schema: {
            type: 'object',
            properties: {
              patientName: { type: 'string', description: 'Nome completo da paciente' },
              patientInfo: { type: 'string', description: 'Idade, peso, comorbidades, data da cirurgia' },
              surgeryType: { type: 'string', description: 'Nome da cirurgia identificada' },
              examResults: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    exam: { type: 'string' },
                    status: { type: 'string', description: '✅/⚠️/❌/❓' },
                    value: { type: 'string' }
                  },
                  required: ['exam', 'status', 'value']
                }
              },
              alerts: { type: 'array', items: { type: 'string' } },
              missingExams: { type: 'array', items: { type: 'string' } },
              alteredExams: { type: 'array', items: { type: 'string' } },
              finalStatus: { type: 'string', description: '✅ Completo sem alertas / ⚠️ Completo com alertas / ❌ Pendente / 🚨 Pendência crítica' },
              conduct: { type: 'string', description: 'Conduta recomendada' },
              blocoResumo: { type: 'string', description: 'Resumo formatado para WhatsApp' },
              relatorioTecnico: { type: 'string', description: 'Relatório técnico completo' }
            },
            required: ['patientName', 'surgeryType', 'finalStatus', 'examResults', 'alerts', 'missingExams', 'alteredExams', 'conduct', 'blocoResumo', 'relatorioTecnico']
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
      relatorio_tecnico: parsed.relatorioTecnico || '',
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
      relatorioTecnico: parsed.relatorioTecnico || '',
      status
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Erro interno.' }, { status: 500 });
  }
});