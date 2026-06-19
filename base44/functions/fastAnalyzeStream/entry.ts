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

const systemPrompt = `Você é um sistema médico especializado em avaliação pré-operatória para cirurgias plásticas eletivas, com foco em segurança anestésica. É EXTREMAMENTE técnico, rigoroso, conservador e baseado em anestesiologia moderna e medicina perioperatória.

## FLUXO OBRIGATÓRIO (4 etapas)
1. CHECKLIST DE COMPLETUDE: verificar exames obrigatórios para a cirurgia.
2. INTERPRETAÇÃO: avaliar TODOS os exames e identificar alterações.
3. VALIDAÇÃO DE QUALIDADE: ilegível/cortado/borrado → sinalizar. NUNCA inventar.
4. AVALIAÇÃO CLÍNICA: comorbidades, medicações, riscos anestésicos.

## CIRURGIAS E EXAMES OBRIGATÓRIOS
${surgeries.map(s => `- **${s.name}** (key: ${s.key}): ${(s.required_exams || []).join(', ')}`).join('\n')}

Cirurgias combinadas = TODOS os exames de TODOS os procedimentos.

## REGRAS CLÍNICAS ABSOLUTAS
- **Hb ≥ 12 g/dL**. Abaixo = alteração relevante.
- **PCR > 10 mg/L** considerar alterada. ≤ 10 não destacar isoladamente.
- **BIRADS 1-2**: ok. **BIRADS 3-6**: encaminhar mastologista + parecer. Sem parecer = 🚨 PENDÊNCIA CRÍTICA. Nunca presumir BIRADS.
- **RX tórax**: nódulo pulmonar sempre sinalizar → pneumologista obrigatório.
- **Anti-HBs < 2**: não contraindica. Não destacar como pendência.
- **GLP-1** (Mounjaro/Ozempic/Wegovy/semaglutida/liraglutida): suspender 21 dias antes da cirurgia.
- **Urina/EAS**: não sinalizar flora isolada, células epiteliais, muco ou contaminação. Só sinalizar se conjunto compatível com ITU.
- **ECG**: FC ≥ 50 bpm isoladamente NÃO é alteração. Avaliar bloqueios, arritmias, isquemia, QT, sobrecargas.
- **Medicações**: avaliar anticoagulantes, antiagregantes, AAS, anticoncepcionais, hipoglicemiantes, corticoides, imunossupressores, psicotrópicos.
- **Exames ilegíveis**: sinalizar "❓ Ilegível — solicitar novo envio". NUNCA inventar.
- **Exame obrigatório não enviado**: "❌ Não enviado".
- **PROIBIDO**: inventar resultados, presumir BIRADS/ECG, ignorar Hb<12, ignorar nódulo, liberar sem exames obrigatórios.

## FORMATO DA RESPOSTA (COMPACTO E OBJETIVO)
Sua resposta deve ser RESUMIDA, em formato checklist/tabela, fácil de copiar para WhatsApp. SEMPRE gere o bloco_resumo separado para cópia rápida. NUNCA gere textos longos. Destacar apenas achados relevantes.`;

    // Baixar arquivos
    const blocks = await Promise.all(fileUrls.map((url, i) => fetchFileBlock(url, i)));

    const content = [];
    content.push({ type: 'text', text: `Analise os ${fileUrls.length} exames anexados.${anamnesis.trim() ? '\n\nANAMNESE:\n' + anamnesis : ''}\n\nSiga o fluxo obrigatório: completude → interpretação → qualidade → avaliação clínica. Seja técnico, rigoroso e conservador. Use output_triage para retornar.` });

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
          description: 'Resultado da triagem pré-anestésica',
          input_schema: {
            type: 'object',
            properties: {
              patientName: { type: 'string', description: 'Nome completo da paciente' },
              patientInfo: { type: 'string', description: 'Idade, peso, altura, comorbidades, data da cirurgia' },
              surgeryType: { type: 'string', description: 'Nome da cirurgia identificada' },
              examResults: { type: 'array', items: { type: 'object', properties: { exam: { type: 'string' }, status: { type: 'string', description: '✅/⚠️/❌/❓' }, value: { type: 'string' } }, required: ['exam', 'status', 'value'] } },
              alerts: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', description: '❌ critico / ⚠️ alerta / ℹ️ informativo' }, text: { type: 'string', description: 'Descrição do alerta' } }, required: ['severity', 'text'] } },
              missingExams: { type: 'array', items: { type: 'string' } },
              alteredExams: { type: 'array', items: { type: 'string' } },
              finalStatus: { type: 'string', description: '✅ Completo sem alertas / ⚠️ Completo com alertas / ❌ Exames pendentes / 🚨 Pendência crítica' },
              conduct: { type: 'string', description: 'Conduta objetiva em até 3 linhas' },
              blocoResumo: { type: 'string', description: 'Bloco RESUMO para WhatsApp: nome, exames alterados/faltando, medicações a suspender, alertas críticos. Formato compacto, bullets, texto único sem tabela.' },
              relatorioTecnico: { type: 'string', description: 'Relatório técnico no formato da tabela ITEM|STATUS + alertas + status final + conduta' },
              medicationsToSuspend: { type: 'array', items: { type: 'object', properties: { medication: { type: 'string' }, reason: { type: 'string' }, period: { type: 'string' } } } }
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