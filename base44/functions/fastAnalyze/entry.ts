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

  // Arquivos de texto (pequenos) — mantém abordagem original
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

    // Prompt médico completo
    const systemPrompt = `Você é um médico anestesista fazendo avaliação pré-operatória de triagem. Execute este prompt com exatidão.

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
- GLP-1 (Ozempic, Mounjaro, Wegovy, Saxenda, Rybelsus, Trulicity): suspender 21 dias antes da cirurgia.
- Avaliar anticoagulantes, antiagregantes, AAS, clopidogrel, rivaroxabana, varfarina, anticoncepcionais, hipoglicemiantes, corticoides, imunossupressores, psicotrópicos.
- Ilegível/cortado/desfocado: informe "❓ Ilegível". NUNCA invente resultado.
- Exame obrigatório não enviado → status "❌ Não enviado".

## PROIBIÇÕES ABSOLUTAS
Nunca: inventar resultados · inventar exames · presumir BIRADS · presumir ECG normal · ignorar Hb < 12 · ignorar nódulo pulmonar · ignorar medicações relevantes · liberar cirurgia sem exames obrigatórios · ignorar exame ilegível · substituir avaliação médica presencial.
Em dúvida → adotar interpretação mais conservadora e segura.

## FORMATO DO RELATÓRIO TÉCNICO (relatorioTecnico)
Use EXATAMENTE este formato:
\`\`\`
🧾 TRIAGEM PRÉ-OPERATÓRIA
👩‍⚕️ Cirurgia: [tipo]

ITEM                  STATUS
Exames obrigatórios   ✅ Completo / ❌ Incompleto
[listar cada exame obrigatório com ✅/⚠️/❌ e valor resumido]

🚨 ALERTAS / ALTERAÇÕES
* [alteração relevante com detalhes]
* [conduta necessária]
(ou: ✅ Sem alterações relevantes identificadas.)

📌 STATUS FINAL
✅ Completo sem alertas relevantes / ⚠️ Completo com alertas / ❌ Exames pendentes / 🚨 Pendência crítica

📋 CONDUTA
[orientação objetiva em até 3 linhas]
\`\`\`

## FORMATO DO BLOCO WHATSAPP (blocoResumo)
Texto único, SEM tabela, otimizado para copiar e colar. Use EXATAMENTE:
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

📌 [✅ liberado / ⚠️ com ressalvas / ❌ pendente / 🚨 não liberar]
\`\`\`

## REGRAS DO BLOCO RESUMO
- Texto único, sem tabela, otimizado para WhatsApp.
- Campo vazio = "nenhum" / "nenhuma".
- Listar em "alterados/faltando" tanto exames alterados quanto obrigatórios ausentes.
- Medicações SEMPRE com tempo de suspensão.
- Não inventar nem presumir — apenas o identificado.

## JSON DE SAÍDA (RETORNE APENAS ISTO, sem markdown)

{
  "patientName": "Nome completo da paciente",
  "patientInfo": "idade, peso, comorbidades, data da cirurgia se disponível",
  "surgeryType": "Nome da cirurgia",
  "examResults": [
    {"exam": "Hemograma", "status": "✅", "value": "Hb 14,0 — normal"},
    {"exam": "Coagulograma", "status": "⚠️", "value": "INR 1,8 — alterado"},
    {"exam": "Beta-HCG", "status": "❌", "value": "Não enviado"},
    {"exam": "Mamografia", "status": "❓", "value": "Ilegível"}
  ],
  "alerts": ["⚠️ INR alterado (1,8) — avaliar coagulopatia", "❌ Beta-HCG não enviado — exame obrigatório"],
  "missingExams": ["Beta-HCG"],
  "alteredExams": ["Coagulograma (INR 1,8)"],
  "finalStatus": "✅ Completo sem alertas relevantes",
  "conduct": "Solicitar Beta-HCG antes da cirurgia. Repetir coagulograma e avaliar hematologista se INR mantiver alterado.",
  "blocoResumo": "📋 RESUMO — TRIAGEM PRÉ-ANESTÉSICA\\n\\nNome: Maria Silva\\nCirurgia: Prótese mamária\\n\\nExames alterados / faltando:\\n• Coagulograma (INR 1,8)\\n• Beta-HCG (não enviado)\\n\\nMedicações a suspender:\\n• Ozempic — suspender por 21 dias\\n\\nAlertas críticos:\\n• nenhum ✅\\n\\n📌 ⚠️ com ressalvas",
  "relatorioTecnico": "🧾 TRIAGEM PRÉ-OPERATÓRIA\\n👩‍⚕️ Cirurgia: Prótese mamária\\n\\nITEM                  STATUS\\n..."
}

IMPORTANTE:
- examResults: liste TODOS os exames obrigatórios. Não enviado = ❌. Ilegível = ❓. Normal = ✅. Alterado = ⚠️.
- missingExams: array apenas com nomes dos exames faltantes (string).
- alteredExams: array com "Nome do exame (valor)" dos alterados.
- blocoResumo: use \\n para quebras de linha. Formato EXATO acima.
- relatorioTecnico: use \\n para quebras. Formato EXATO acima.
- Retorne JSON PURO, sem markdown, sem texto antes ou depois.`;

    // Baixar todos os arquivos em paralelo
    console.log(`Baixando ${fileUrls.length} arquivos...`);
    const blocks = await Promise.all(fileUrls.map((url, i) => fetchFileBlock(url, i)));

    const content = [];
    content.push({ type: 'text', text: `Analise TODOS os ${fileUrls.length} exames anexados como um médico anestesista experiente.${anamnesis.trim() ? '\n\nANAMNESE / OBSERVAÇÕES:\n' + anamnesis : ''}\n\nSiga EXATAMENTE o protocolo de triagem pré-anestésica. Identifique paciente, cirurgia, compare cada exame com os limites de referência, verifique completude, e gere o relatório no formato exato especificado. Retorne SOMENTE o JSON.` });

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (!b) {
        content.push({ type: 'text', text: `--- EXAME [${i + 1}]: indisponível ---` });
      } else {
        content.push({ type: 'text', text: `--- EXAME [${i + 1}] ---` });
        content.push(b);
      }
    }

    console.log('Chamando Claude...');
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4096, system: systemPrompt, messages: [{ role: 'user', content }] })
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      throw new Error(`Claude (${claudeRes.status}): ${err.substring(0, 200)}`);
    }

    const data = await claudeRes.json();
    const text = (data.content?.[0]?.text || '').trim();

    // Parse JSON (limpa markdown + repara erros comuns)
    let parsed;
    const cleanJson = (raw) => {
      let s = raw
        .replace(/```json\s*/g, '').replace(/```\s*/g, '')
        .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '') // comentários
        .replace(/,\s*([}\]])/g, '$1') // trailing commas
        .replace(/\n/g, ' ').replace(/\r/g, '')
        .trim();
      // Remove texto antes da primeira { e depois da última }
      const firstBrace = s.indexOf('{');
      const lastBrace = s.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        s = s.substring(firstBrace, lastBrace + 1);
      }
      return s;
    };

    try {
      parsed = JSON.parse(cleanJson(text));
    } catch (e1) {
      // Segunda tentativa: regex extraction com limpeza
      try {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(cleanJson(match[0]));
      } catch (e2) {
        throw new Error(`JSON inválido: ${e2.message}. Resposta crua: ${text.substring(0, 500)}`);
      }
    }

    if (!parsed || !parsed.patientName) {
      throw new Error('Resposta da IA não contém JSON válido: ' + text.substring(0, 300));
    }

    // Determinar status para salvar
    let status = 'incomplete';
    if (parsed.finalStatus?.includes('crítica') || parsed.finalStatus?.includes('🚨')) status = 'critical_pending';
    else if (parsed.finalStatus?.includes('sem alertas') || parsed.finalStatus?.includes('✅')) status = 'complete_without_alerts';
    else if (parsed.finalStatus?.includes('com alertas') || parsed.finalStatus?.includes('⚠️')) status = 'complete_with_alerts';

    // Salvar no banco
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
    console.error('Erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});