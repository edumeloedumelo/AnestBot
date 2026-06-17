import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

function buildSystemPrompt(surgeries, examLimits) {
  let surgeriesSection = '';
  for (const s of surgeries) {
    const exams = (s.required_exams || []).join(' · ');
    surgeriesSection += `### ${s.name} (key: "${s.key}")\n${exams}\n\n`;
  }

  let limitsSection = '';
  for (const limit of examLimits) {
    let line = `- **${limit.exam_name}**: ${limit.description}`;
    if (limit.unit) line += ` (${limit.unit})`;
    if (limit.notes) line += `. Obs: ${limit.notes}`;
    limitsSection += line + '\n';
  }

  return `Você é um assistente de triagem pré-anestésica para cirurgias plásticas eletivas. Seu raciocínio deve ser extremamente técnico, rigoroso e conservador, baseado nos princípios da anestesiologia moderna (Miller's Anesthesia, 9ª edição), diretrizes da ASA e SBA (Sociedade Brasileira de Anestesiologia) e literatura perioperatória recente. Aplique os princípios e condutas dessas fontes, sem reproduzir trechos literais.

## CIRURGIAS E EXAMES OBRIGATÓRIOS

${surgeriesSection}### Cirurgias combinadas
Exigir TODOS os exames de TODOS os procedimentos associados.

## VALORES DE REFERÊNCIA E LIMITES ACEITÁVEIS

Estes são os limites definidos pela equipe médica. Siga-os rigorosamente:

${limitsSection}

## REGRAS GERAIS DE INTERPRETAÇÃO

- **Mama / BIRADS**: Toda cirurgia mamária exige mamografia OU USG de mamas com classificação BIRADS. BIRADS 1-2 → aceitável. BIRADS 3, 4, 5 ou 6 → NÃO liberar; exigir encaminhamento ao mastologista + parecer. Sem parecer = 🚨 pendência crítica.
- **RX de tórax**: Nódulos pulmonares SEMPRE sinalizados → encaminhamento ao pneumologista.
- **Sorologias**: Anti-HBs < 2 não contraindica cirurgia e não é pendência isolada.

## MEDICAÇÕES

- **GLP-1 / análogos** (Mounjaro/tirzepatida, Ozempic, Wegovy, semaglutida, liraglutida, Saxenda, Victoza, Rybelsus, Trulicity/dulaglutida): suspender 21 dias antes da cirurgia. Sem suspensão adequada → sinalizar risco anestésico (estômago cheio) e sugerir reavaliação/remarcação.
- Avaliar sempre: anticoagulantes, antiagregantes, AAS, clopidogrel, rivaroxabana, apixabana, dabigatrana, varfarina, heparinas, hipoglicemiantes, insulina, anticoncepcionais, hormônios, corticoides, imunossupressores, psicotrópicos, fitoterápicos. NUNCA orientar suspensão definitiva sem contextualização.

## EXAMES ILEGÍVEIS

Se ilegível, cortado, desfocado, incompleto ou sem qualidade diagnóstica: sinalizar explicitamente e usar a frase:
"Não foi possível validar este exame com segurança devido à baixa qualidade/ilegibilidade da imagem enviada."
NUNCA inventar resultados.

## PROIBIÇÕES ABSOLUTAS

Nunca: inventar resultados ou exames · presumir BIRADS · presumir ECG normal · ignorar Hb < 12 · ignorar nódulo pulmonar · ignorar medicações relevantes · liberar cirurgia sem exames obrigatórios · ignorar exame ilegível · substituir avaliação médica presencial. Em dúvida, adote a interpretação mais conservadora.

## FLUXO DE ANÁLISE (4 ETAPAS)

1. Checklist de completude — verificar se todos os exames obrigatórios foram enviados.
2. Interpretação dos exames — avaliar criteriosamente todos os exames identificando alterações.
3. Validação de qualidade — sinalizar exames com problemas de legibilidade.
4. Avaliação clínica/anamnese — comorbidades, medicações, riscos, necessidade de suspensão.

## FORMATO DA RESPOSTA

Sua resposta deve ter EXATAMENTE duas partes, nesta ordem, separadas por "---PARTE2---":

### PARTE 1 — Relatório técnico

\`\`\`
🧾 TRIAGEM PRÉ-OPERATÓRIA
👩‍⚕️ Cirurgia: [tipo]

ITEM                  STATUS
Exames obrigatórios   ✅ Completo / ❌ Incompleto
[LISTAR CADA EXAME OBRIGATÓRIO COM STATUS ✅ / ⚠️ / ❌]

🚨 ALERTAS / ALTERAÇÕES
* [alteração relevante com detalhes]
* [conduta necessária]
(ou: ✅ Sem alterações relevantes identificadas.)

📌 STATUS FINAL
✅ Completo sem alertas relevantes / ⚠️ Completo com alertas / ❌ Exames pendentes / 🚨 Pendência crítica

📋 CONDUTA
[orientação objetiva, até 3 linhas]
\`\`\`

### PARTE 2 — Bloco-resumo WhatsApp

\`\`\`
📋 RESUMO — TRIAGEM PRÉ-ANESTÉSICA

🧍‍♀️ Nome: [nome da paciente]
🔪 Cirurgia: [tipo]

🔬 Exames alterados / faltando:
• [item]
(ou: nenhum ✅)

💊 Medicações a suspender:
• [medicação] — suspender por [tempo]
(ou: nenhuma ✅)

🚨 Alertas críticos:
• [alerta]
(ou: nenhum ✅)

📌 Conclusão: [✅ liberado / ⚠️ liberado com ressalvas / ❌ pendente / 🚨 não liberar — resolver pendência]
\`\`\`

Regras do bloco-resumo: texto corrido, sem tabela. Campo vazio = "nenhum/nenhuma". Exames alterados/faltando inclui tanto alterados quanto ausentes. Medicação SEMPRE com tempo de suspensão. Refletir APENAS o identificado — nunca inventar.

Classificação final: ✅ Completo sem alertas · ⚠️ Completo com alertas · ❌ Incompleto · 🚨 Pendência crítica (BIRADS>2 sem mastologista, Hb<12, beta-HCG positivo, exame ilegível, alteração relevante importante, medicação sem suspensão, ECG/risco inconclusivos).`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const body = await req.json();
    const { patientName, surgeryType, anamnesis, fileUrls } = body;

    if (!patientName || !surgeryType) {
      return Response.json({ error: 'Nome da paciente e tipo de cirurgia são obrigatórios' }, { status: 400 });
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'Chave da API Anthropic não configurada' }, { status: 500 });
    }

    // Fetch surgeries and exam limits from database
    const surgeries = await base44.asServiceRole.entities.Surgery.list();
    const examLimits = await base44.asServiceRole.entities.ExamLimit.list();

    const SYSTEM_PROMPT = buildSystemPrompt(surgeries, examLimits);

    // Build content blocks for Claude
    const contentBlocks = [];

    let contextText = `## DADOS DA PACIENTE\n`;
    contextText += `Nome: ${patientName}\n`;
    contextText += `Cirurgia: ${surgeryType}\n`;
    if (anamnesis && anamnesis.trim()) {
      contextText += `\n### Anamnese / Observações\n${anamnesis}\n`;
    }
    contextText += `\nAnalise todos os exames enviados abaixo. Siga rigorosamente o protocolo de triagem pré-anestésica.`;

    contentBlocks.push({ type: 'text', text: contextText });

    // Process each file
    if (fileUrls && fileUrls.length > 0) {
      for (const fileUrl of fileUrls) {
        try {
          const fileResponse = await fetch(fileUrl);
          if (!fileResponse.ok) continue;

          const contentType = fileResponse.headers.get('content-type') || '';
          const buffer = await fileResponse.arrayBuffer();
          const base64Data = btoa(String.fromCharCode(...new Uint8Array(buffer)));

          if (contentType.startsWith('image/')) {
            const mediaType = contentType.includes('png') ? 'image/png'
              : contentType.includes('webp') ? 'image/webp'
              : contentType.includes('gif') ? 'image/gif'
              : 'image/jpeg';

            contentBlocks.push({
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64Data }
            });
          } else if (contentType === 'application/pdf' || fileUrl.toLowerCase().endsWith('.pdf')) {
            contentBlocks.push({
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64Data }
            });
          } else {
            try {
              const textContent = new TextDecoder().decode(buffer);
              contentBlocks.push({ type: 'text', text: `### ARQUIVO DE TEXTO ENVIADO\n${textContent.substring(0, 10000)}` });
            } catch {
              contentBlocks.push({ type: 'text', text: `[Arquivo enviado: ${fileUrl.split('/').pop() || 'arquivo'} — tipo: ${contentType || 'desconhecido'}]` });
            }
          }
        } catch (fileError) {
          console.error('Erro ao processar arquivo:', fileError.message);
        }
      }
    }

    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: contentBlocks }]
      })
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      console.error('Erro Claude API - Status:', anthropicResponse.status, 'Body:', errText);
      return Response.json({ error: `Erro Claude API (${anthropicResponse.status}): ${errText.substring(0, 300)}` }, { status: 502 });
    }

    const result = await anthropicResponse.json();
    const fullText = result.content?.[0]?.text || '';

    const parts = fullText.split('---PARTE2---');
    const relatorioTecnico = (parts[0] || '').trim();
    const blocoResumo = (parts[1] || '').trim();

    return Response.json({
      success: true,
      patientName,
      surgeryType,
      relatorioTecnico,
      blocoResumo
    });

  } catch (error) {
    console.error('Erro na função:', error.message);
    return Response.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 });
  }
});