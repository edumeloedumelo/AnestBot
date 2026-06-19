import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const { fileUrls = [], anamnesis = '' } = body;
    if (!fileUrls.length) return Response.json({ error: 'Nenhum arquivo' }, { status: 400 });

    const base44 = createClientFromRequest(req);
    const [surgeries, examLimits] = await Promise.all([
      base44.asServiceRole.entities.Surgery.list(),
      base44.asServiceRole.entities.ExamLimit.list()
    ]);

    const prompt = `Você é um médico anestesista experiente fazendo avaliação pré-operatória de triagem.

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
- Avaliar anticoagulantes, antiagregantes, AAS, clopidogrel, rivaroxabana, varfarina, anticoncepcionais, hipoglicemiantes, corticoides, imunossupressores, psicotrópicos.
- Ilegível/cortado/desfocado: "❓ Ilegível". NUNCA invente.
- Exame obrigatório não enviado → "❌ Não enviado".

## PROIBIÇÕES ABSOLUTAS
Nunca: inventar resultados · inventar exames · presumir BIRADS · presumir ECG normal · ignorar Hb < 12 · ignorar nódulo pulmonar · ignorar medicações relevantes · liberar cirurgia sem exames obrigatórios · ignorar exame ilegível · substituir avaliação médica presencial.
Em dúvida → interpretação mais conservadora.

## FORMATO DO RELATÓRIO TÉCNICO (relatorioTecnico)
\`\`\`
🧾 TRIAGEM PRÉ-OPERATÓRIA
👩‍⚕️ Cirurgia: [tipo]

ITEM                  STATUS
[listar cada exame obrigatório com ✅/⚠️/❌/❓ e valor resumido]

🚨 ALERTAS / ALTERAÇÕES
* [alteração relevante]
(ou: ✅ Sem alterações relevantes identificadas.)

📌 STATUS FINAL: [✅/⚠️/❌/🚨]

📋 CONDUTA: [orientação em até 3 linhas]
\`\`\`

## FORMATO DO BLOCO WHATSAPP (blocoResumo)
\`\`\`
📋 RESUMO — TRIAGEM PRÉ-ANESTÉSICA

Nome: [nome]
Cirurgia: [tipo]

Exames alterados / faltando:
• [item] (ou: nenhum ✅)

Medicações a suspender:
• [medicação] — suspender por [tempo] (ou: nenhuma ✅)

Alertas críticos:
• [alerta] (ou: nenhum ✅)

📌 [✅ / ⚠️ / ❌ / 🚨]
\`\`\`

## TAREFA
Analise TODOS os ${fileUrls.length} exames anexados.
${anamnesis.trim() ? 'ANAMNESE / OBSERVAÇÕES:\n' + anamnesis + '\n' : ''}
Siga EXATAMENTE o protocolo de triagem.`;

    const result = await base44.integrations.Core.InvokeLLM({
      prompt,
      file_urls: fileUrls,
      model: 'claude_sonnet_4_6',
      response_json_schema: {
        type: 'object',
        properties: {
          patientName: { type: 'string' },
          patientInfo: { type: 'string' },
          surgeryType: { type: 'string' },
          examResults: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                exam: { type: 'string' },
                status: { type: 'string' },
                value: { type: 'string' }
              },
              required: ['exam', 'status', 'value']
            }
          },
          alerts: { type: 'array', items: { type: 'string' } },
          missingExams: { type: 'array', items: { type: 'string' } },
          alteredExams: { type: 'array', items: { type: 'string' } },
          finalStatus: { type: 'string' },
          conduct: { type: 'string' },
          blocoResumo: { type: 'string' },
          relatorioTecnico: { type: 'string' }
        },
        required: ['patientName', 'surgeryType', 'finalStatus']
      }
    });

    if (!result || !result.patientName) {
      return Response.json({ error: 'IA não conseguiu identificar a paciente.' }, { status: 500 });
    }

    let status = 'incomplete';
    const fs = result.finalStatus || '';
    if (fs.includes('crítica') || fs.includes('🚨')) status = 'critical_pending';
    else if (fs.includes('sem alertas') || fs.includes('✅')) status = 'complete_without_alerts';
    else if (fs.includes('com alertas') || fs.includes('⚠️')) status = 'complete_with_alerts';

    await base44.asServiceRole.entities.Triage.create({
      patient_name: result.patientName,
      surgery_type: result.surgeryType || 'indefinida',
      status,
      missing_exams: result.missingExams || [],
      altered_exams: result.alteredExams || [],
      relatorio_tecnico: result.relatorioTecnico || '',
      bloco_resumo: result.blocoResumo || '',
      files_count: fileUrls.length
    });

    return Response.json({
      patientName: result.patientName,
      patientInfo: result.patientInfo || '',
      surgeryType: result.surgeryType || 'indefinida',
      examResults: result.examResults || [],
      alerts: result.alerts || [],
      missingExams: result.missingExams || [],
      alteredExams: result.alteredExams || [],
      finalStatus: result.finalStatus || '❌ Pendente',
      conduct: result.conduct || '',
      blocoResumo: result.blocoResumo || '',
      relatorioTecnico: result.relatorioTecnico || '',
      status
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Erro interno.' }, { status: 500 });
  }
});