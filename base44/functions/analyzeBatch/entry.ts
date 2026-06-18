import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

function buildIdentifyPrompt(surgeries) {
  const surgeryKeys = surgeries.map(s => `"${s.key}"`).join(', ');
  const surgeryList = surgeries.map(s => `- **${s.name}** → key: "${s.key}"`).join('\n');

  return `Você é um assistente médico especializado em triagem pré-anestésica. Sua tarefa é analisar arquivos de exames enviados e identificar pacientes e tipos de exames.

## INSTRUÇÕES

Analise cada arquivo enviado e extraia:
1. **Nome do paciente** — procure o nome completo em cada exame/laudo. Se não encontrar, use "Paciente não identificado".
2. **Tipo de exame** — classifique cada arquivo como um dos tipos abaixo:
   - Hemograma
   - Coagulograma (TP/INR, TTPA)
   - Ionograma (Na, K, Cl)
   - Bioquímica renal (ureia, creatinina)
   - Mamografia / USG de mamas
   - Sorologias (HIV, Hepatite B, Hepatite C)
   - Beta-HCG
   - Urina / EAS
   - ECG / Eletrocardiograma
   - RX de tórax
   - Risco cirúrgico (avaliação cardiológica/clínica)
   - USG de abdome
   - USG de parede abdominal
   - Outro (especifique)

3. **Possível tipo de cirurgia** — PRIMEIRO, procure na anamnese (se fornecida) o nome da cirurgia. Depois, complemente analisando o conjunto de exames. Use APENAS uma das seguintes keys:

${surgeryList}

Se a cirurgia identificada não corresponder a nenhuma das opções acima OU a anamnese mencionar múltiplas cirurgias, use "combinada".
Se não for possível identificar por nenhum meio, use "indefinida".

Retorne EXATAMENTE um JSON válido com a seguinte estrutura, sem texto adicional fora do JSON:

{
  "patients": [
    {
      "name": "Nome da Paciente",
      "surgeryType": ${surgeryKeys.length ? surgeryKeys + ' ou "combinada" ou "indefinida"' : '"indefinida"'},
      "exams": [
        {"type": "Hemograma", "fileIndex": 0},
        {"type": "ECG", "fileIndex": 1}
      ]
    }
  ],
  "unidentifiedFiles": [3, 5]
}

Regras:
- Agrupe exames pelo mesmo nome de paciente (compare nomes de forma aproximada — "Maria Silva" e "Maria S." são a mesma pessoa)
- fileIndex deve corresponder ao índice (baseado em 0) do arquivo na ordem em que foi enviado
- Se houver dúvida sobre o nome, coloque o paciente como separado
- unidentifiedFiles: índices de arquivos que não puderam ser associados a nenhum paciente`;
}

function buildTriagePrompt(surgeries, examLimits) {
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

  return `Você é um assistente de triagem pré-anestésica para cirurgias plásticas eletivas. Seu raciocínio deve ser extremamente técnico, rigoroso e conservador, baseado nos princípios da anestesiologia moderna (Miller's Anesthesia, 9ª edição), diretrizes da ASA e SBA e literatura perioperatória recente.

## CIRURGIAS E EXAMES OBRIGATÓRIOS

${surgeriesSection}### Cirurgias combinadas
Exigir TODOS os exames de TODOS os procedimentos associados.

## VALORES DE REFERÊNCIA E LIMITES ACEITÁVEIS

Estes são os limites definidos pela equipe médica. Siga-os rigorosamente:

${limitsSection}

## REGRAS GERAIS DE INTERPRETAÇÃO

- **Mama / BIRADS**: Toda cirurgia mamária exige mamografia OU USG de mamas com classificação BIRADS. BIRADS 1-2 → aceitável. BIRADS 3, 4, 5 ou 6 → NÃO liberar; exigir encaminhamento ao mastologista + parecer. Sem parecer = 🚨 pendência crítica.
- **RX de tórax**: Nódulos pulmonares SEMPRE sinalizados → encaminhamento ao pneumologista.
- **Sorologias**: Anti-HBs < 2 não contraindica cirurgia.

## MEDICAÇÕES

- **GLP-1 / análogos** (Mounjaro, Ozempic, Wegovy, semaglutida, liraglutida, Saxenda, Victoza, Rybelsus, Trulicity): suspender 21 dias antes. Sem suspensão → sinalizar risco anestésico.
- Avaliar: anticoagulantes, antiagregantes, AAS, clopidogrel, rivaroxabana, apixabana, dabigatrana, varfarina, heparinas, hipoglicemiantes, insulina, anticoncepcionais, hormônios, corticoides, imunossupressores, psicotrópicos, fitoterápicos.

## EXAMES ILEGÍVEIS

Se ilegível, cortado, desfocado, incompleto ou sem qualidade: sinalizar com a frase:
"Não foi possível validar este exame com segurança devido à baixa qualidade/ilegibilidade da imagem enviada."
NUNCA inventar resultados.

## PROIBIÇÕES ABSOLUTAS

Nunca: inventar resultados · presumir BIRADS · presumir ECG normal · ignorar Hb < 12 · ignorar nódulo pulmonar · ignorar medicações · liberar sem exames obrigatórios · ignorar exame ilegível · substituir avaliação médica. Em dúvida, adote a interpretação mais conservadora.

## FORMATO DA RESPOSTA

Sua resposta deve ter EXATAMENTE duas partes, nesta ordem, separadas por "---PARTE2---":

### PARTE 1 — Relatório técnico
\`\`\`
🧾 TRIAGEM PRÉ-OPERATÓRIA
👩‍⚕️ Paciente: [nome]
🔪 Cirurgia: [tipo]

ITEM                  STATUS
Exames obrigatórios   ✅ Completo / ❌ Incompleto
[LISTAR CADA EXAME OBRIGATÓRIO COM STATUS ✅ / ⚠️ / ❌]

🚨 ALTERAÇÕES
* [alteração relevante com detalhes]
(ou: ✅ Sem alterações relevantes.)

📌 STATUS FINAL
✅ Completo sem alertas / ⚠️ Completo com alertas / ❌ Pendente / 🚨 Pendência crítica

📋 CONDUTA
[orientação objetiva, até 3 linhas]
\`\`\`

### PARTE 2 — Bloco-resumo WhatsApp
\`\`\`
📋 RESUMO — TRIAGEM PRÉ-ANESTÉSICA
🧍‍♀️ Nome: [nome]
🔪 Cirurgia: [tipo]

🔬 Exames alterados / faltando:
• [item]
(ou: nenhum ✅)

💊 Medicações a suspender:
• [medicação] — [tempo]
(ou: nenhuma ✅)

🚨 Alertas críticos:
• [alerta]
(ou: nenhum ✅)

📌 Conclusão: [✅ liberado / ⚠️ liberado com ressalvas / ❌ pendente / 🚨 não liberar]
\`\`\`

Classificação final: ✅ Completo sem alertas · ⚠️ Completo com alertas · ❌ Incompleto · 🚨 Pendência crítica`;
}

// Cria content block com URL (sem baixar o arquivo)
function fileUrlToBlock(url, index) {
  const lower = url.toLowerCase();
  const isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(url.split('?')[0]);

  if (isImage) {
    return { type: 'image', source: { type: 'url', url } };
  }

  if (lower.includes('.pdf') || lower.includes('application/pdf')) {
    return { type: 'document', source: { type: 'url', url } };
  }

  // Arquivo de texto ou desconhecido — faz download leve
  return null; // será tratado como texto
}

async function callClaude(systemPrompt, contentBlocks, apiKey, maxTokens = 4096) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: contentBlocks }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API (${response.status}): ${errText.substring(0, 300)}`);
  }

  const result = await response.json();
  return result.content?.[0]?.text || '';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const body = await req.json();
    const { fileUrls = [], anamnesis } = body;

    if (!fileUrls.length) {
      return Response.json({ error: 'Nenhum arquivo enviado' }, { status: 400 });
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'Chave da API Anthropic não configurada' }, { status: 500 });
    }

    const [surgeries, examLimits] = await Promise.all([
      base44.asServiceRole.entities.Surgery.list(),
      base44.asServiceRole.entities.ExamLimit.list()
    ]);

    const IDENTIFY_SYSTEM_PROMPT = buildIdentifyPrompt(surgeries);
    const TRIAGE_SYSTEM_PROMPT = buildTriagePrompt(surgeries, examLimits);

    // --- FASE 1: Identificar pacientes (usa URLs direto, sem download) ---
    console.log(`FASE 1: Identificando pacientes em ${fileUrls.length} arquivos...`);

    const identifyBlocks = [];
    let identifyContext = `Analise os ${fileUrls.length} arquivos abaixo. Identifique o nome do paciente em cada um, o tipo de exame, e agrupe por paciente.`;
    if (anamnesis?.trim()) {
      identifyContext += `\n\n## ANAMNESE FORNECIDA\n${anamnesis}\n\nUse a anamnese acima para identificar o tipo de cirurgia e o nome da(s) paciente(s).`;
    }
    identifyContext += `\n\nRetorne APENAS o JSON.`;
    identifyBlocks.push({ type: 'text', text: identifyContext });

    for (let i = 0; i < fileUrls.length; i++) {
      const block = fileUrlToBlock(fileUrls[i], i);
      if (block) {
        identifyBlocks.push({ type: 'text', text: `--- ARQUIVO [${i}] ---` });
        identifyBlocks.push(block);
      }
    }

    const identifyText = await callClaude(IDENTIFY_SYSTEM_PROMPT, identifyBlocks, apiKey, 2048);

    let patientGroups;
    try {
      const jsonMatch = identifyText.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : identifyText;
      patientGroups = JSON.parse(jsonStr);
    } catch (e) {
      console.error('Erro ao parsear JSON de identificação:', e.message);
      return Response.json({ error: 'Não foi possível identificar os pacientes nos arquivos enviados.' }, { status: 422 });
    }

    const patients = patientGroups.patients || [];
    console.log(`FASE 1 concluída: ${patients.length} pacientes encontrados`);

    // --- FASE 2: Triagem em PARALELO (URLs direto, sem download) ---
    console.log(`FASE 2: Triagem para ${patients.length} pacientes em paralelo...`);

    const patientPromises = patients.map(async (patient) => {
      const triageBlocks = [];
      let context = `## DADOS DA PACIENTE\nNome: ${patient.name}\nCirurgia: ${patient.surgeryType || 'indefinida'}\n`;
      if (anamnesis?.trim()) {
        context += `\n### Anamnese compartilhada\n${anamnesis}\n`;
      }
      context += `\nAnalise os exames abaixo. Siga rigorosamente o protocolo.`;
      triageBlocks.push({ type: 'text', text: context });

      for (const exam of (patient.exams || [])) {
        const idx = exam.fileIndex;
        if (idx >= 0 && idx < fileUrls.length) {
          triageBlocks.push({ type: 'text', text: `--- ${exam.type || 'Exame'} ---` });
          const block = fileUrlToBlock(fileUrls[idx], idx);
          if (block) triageBlocks.push(block);
        }
      }

      const triageText = await callClaude(TRIAGE_SYSTEM_PROMPT, triageBlocks, apiKey, 4096);
      const parts = triageText.split('---PARTE2---');
      const relatorio = (parts[0] || '').trim();
      const resumo = (parts[1] || '').trim();

      let status = 'incomplete';
      if (relatorio.includes('🚨 Pendência crítica')) status = 'critical_pending';
      else if (relatorio.includes('✅ Completo sem alertas')) status = 'complete_without_alerts';
      else if (relatorio.includes('⚠️ Completo com alertas')) status = 'complete_with_alerts';
      else if (relatorio.includes('❌ Incompleto') || relatorio.includes('❌ Pendente')) status = 'incomplete';

      return {
        patientName: patient.name,
        surgeryType: patient.surgeryType || 'indefinida',
        relatorioTecnico: relatorio,
        blocoResumo: resumo,
        status
      };
    });

    const results = await Promise.all(patientPromises);

    // Salvar no banco em paralelo
    await Promise.all(results.map(r =>
      base44.asServiceRole.entities.Triage.create({
        patient_name: r.patientName,
        surgery_type: r.surgeryType,
        status: r.status,
        relatorio_tecnico: r.relatorioTecnico,
        bloco_resumo: r.blocoResumo,
        files_count: fileUrls.length
      })
    ));

    return Response.json({
      success: true,
      totalFiles: fileUrls.length,
      totalPatients: results.length,
      results
    });

  } catch (error) {
    console.error('Erro:', error.message);
    return Response.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 });
  }
});