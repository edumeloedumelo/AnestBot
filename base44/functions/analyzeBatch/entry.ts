import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

function buildIdentifyPrompt(surgeries) {
  const surgeryKeys = surgeries.map(s => `"${s.key}"`).join(', ');
  const surgeryList = surgeries.map(s => `- **${s.name}** → key: "${s.key}"`).join('\n');

  return `Você é um assistente médico especializado em triagem pré-anestésica. Analise os arquivos de exames e identifique pacientes e tipos de exames.

Retorne EXATAMENTE um JSON, sem texto adicional:
{
  "patients": [
    {
      "name": "Nome da Paciente",
      "surgeryType": ${surgeryKeys.length ? surgeryKeys + ' ou "combinada" ou "indefinida"' : '"indefinida"'},
      "exams": [{"type": "Hemograma", "fileIndex": 0}]
    }
  ],
  "unidentifiedFiles": []
}

Tipos de exame: Hemograma, Coagulograma, Ionograma, Bioquímica renal, Mamografia / USG de mamas, Sorologias, Beta-HCG, Urina / EAS, ECG, RX de tórax, Risco cirúrgico, USG de abdome, USG de parede abdominal, Outro

Cirurgias conhecidas:
${surgeryList}

Agrupe exames por nome de paciente (aproximação: "Maria Silva" ≈ "Maria S."). Se não identificar, use "Paciente não identificado".
Se houver anamnese, use-a para identificar a cirurgia. Na dúvida, use "indefinida". Múltiplas cirurgias → "combinada".
fileIndex = índice do arquivo (base 0) na ordem enviada.`;
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

  return `Você é um assistente de triagem pré-anestésica para cirurgias plásticas eletivas. Raciocínio técnico, rigoroso e conservador.

## CIRURGIAS E EXAMES OBRIGATÓRIOS
${surgeriesSection}
### Cirurgias combinadas — exigir TODOS os exames de TODOS os procedimentos.

## LIMITES
${limitsSection}

## REGRAS
- Mama/BIRADS: 1-2 ok. 3-6 → encaminhar mastologista. Sem parecer = 🚨 crítica.
- RX tórax: nódulo → pneumologista.
- Anti-HBs < 2 não contraindica.
- GLP-1 (Ozempic, Mounjaro, etc): suspender 21d. Sem suspensão → alerta.
- Ilegível/cortado/desfocado: "Não foi possível validar este exame — baixa qualidade.", NUNCA inventar.
- NUNCA: inventar resultado, presumir BIRADS/ECG, ignorar Hb<12, nódulo, medicação, exame obrigatório.

## RESPOSTA (duas partes separadas por ---PARTE2---)

PARTE 1 — Relatório:
\`\`\`
🧾 TRIAGEM PRÉ-OPERATÓRIA
👩‍⚕️ Paciente: [nome]
🔪 Cirurgia: [tipo]
Exames obrigatórios: ✅/❌
[listar cada exame com ✅/⚠️/❌]
🚨 ALTERAÇÕES: [listar ou "✅ Sem alterações"]
📌 STATUS: ✅ Completo sem alertas / ⚠️ Completo com alertas / ❌ Pendente / 🚨 Pendência crítica
📋 CONDUTA: [até 3 linhas]
\`\`\`

PARTE 2 — WhatsApp:
\`\`\`
📋 RESUMO — TRIAGEM PRÉ-ANESTÉSICA
🧍‍♀️ Nome: [nome] | 🔪 Cirurgia: [tipo]
🔬 Alterados/faltando: [listar ou "nenhum ✅"]
💊 Suspender: [listar ou "nenhuma ✅"]
🚨 Críticos: [listar ou "nenhum ✅"]
📌 [✅ liberado / ⚠️ com ressalvas / ❌ pendente / 🚨 não liberar]
\`\`\``;
}

// Codifica ArrayBuffer para base64 em chunks (evita "Maximum call stack" em arquivos grandes)
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  const chunks = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    chunks.push(String.fromCharCode(...chunk));
  }
  return btoa(chunks.join(''));
}

async function fetchFileAsBlock(url, index) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const contentType = res.headers.get('content-type') || '';
  const buffer = await res.arrayBuffer();
  const base64Data = arrayBufferToBase64(buffer);

  const lower = url.toLowerCase();
  const isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(url.split('?')[0]) || contentType.startsWith('image/');

  if (isImage) {
    const mediaType = contentType.includes('png') ? 'image/png'
      : contentType.includes('webp') ? 'image/webp'
      : contentType.includes('gif') ? 'image/gif'
      : 'image/jpeg';
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } };
  }

  if (contentType === 'application/pdf' || lower.includes('.pdf')) {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } };
  }

  // Texto
  const text = new TextDecoder().decode(buffer);
  return { type: 'text', text: `[Arquivo ${index}]\n${text.substring(0, 8000)}` };
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
    const body = await req.json();
    const { fileUrls = [], anamnesis } = body;

    if (!fileUrls.length) {
      return Response.json({ error: 'Nenhum arquivo enviado' }, { status: 400 });
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'Chave da API não configurada' }, { status: 500 });
    }

    const base44 = createClientFromRequest(req);

    // Carregar dados do banco (service role para garantir acesso)
    const [surgeries, examLimits] = await Promise.all([
      base44.asServiceRole.entities.Surgery.list(),
      base44.asServiceRole.entities.ExamLimit.list()
    ]);

    const IDENTIFY_PROMPT = buildIdentifyPrompt(surgeries);
    const TRIAGE_PROMPT = buildTriagePrompt(surgeries, examLimits);

    // --- FASE 1: Baixar e identificar ---
    console.log(`Baixando ${fileUrls.length} arquivos...`);
    const downloadPromises = fileUrls.map((url, i) => fetchFileAsBlock(url, i));
    const fileBlocks = await Promise.all(downloadPromises);

    console.log('FASE 1: Identificando pacientes...');
    const identifyBlocks = [];
    let ctx = `Analise os ${fileUrls.length} arquivos. Identifique paciente, tipo de exame, cirurgia.`;
    if (anamnesis?.trim()) ctx += `\n\nANAMNESE:\n${anamnesis}`;
    ctx += '\n\nRetorne APENAS o JSON.';
    identifyBlocks.push({ type: 'text', text: ctx });

    for (let i = 0; i < fileBlocks.length; i++) {
      identifyBlocks.push({ type: 'text', text: `--- ARQUIVO [${i}] ---` });
      if (fileBlocks[i]) {
        identifyBlocks.push(fileBlocks[i]);
      } else {
        identifyBlocks.push({ type: 'text', text: `[Arquivo ${i} indisponível]` });
      }
    }

    const identifyText = await callClaude(IDENTIFY_PROMPT, identifyBlocks, apiKey, 4096);

    const cleanJson = (raw) => {
      let s = raw
        .replace(/```json\s*/g, '').replace(/```\s*/g, '')
        .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/\n/g, ' ').replace(/\r/g, '')
        .trim();
      const firstBrace = s.indexOf('{');
      const lastBrace = s.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        s = s.substring(firstBrace, lastBrace + 1);
      }
      return s;
    };

    let patientGroups;
    try {
      patientGroups = JSON.parse(cleanJson(identifyText));
    } catch (e1) {
      const jsonMatch = identifyText.match(/\{[\s\S]*\}/);
      try {
        patientGroups = JSON.parse(cleanJson(jsonMatch ? jsonMatch[0] : identifyText));
      } catch (e2) {
        console.error('JSON inválido:', e2.message);
        return Response.json({ error: 'Não foi possível identificar os pacientes.' }, { status: 422 });
      }
    }

    const patients = patientGroups.patients || [];
    console.log(`${patients.length} pacientes encontrados`);

    // --- FASE 2: Triagem em paralelo ---
    const patientPromises = patients.map(async (patient) => {
      const blocks = [];
      let pCtx = `Paciente: ${patient.name}\nCirurgia: ${patient.surgeryType || 'indefinida'}`;
      if (anamnesis?.trim()) pCtx += `\nAnamnese: ${anamnesis}`;
      pCtx += '\nAnalise os exames. Siga o protocolo.';
      blocks.push({ type: 'text', text: pCtx });

      for (const exam of (patient.exams || [])) {
        const idx = exam.fileIndex;
        blocks.push({ type: 'text', text: `--- ${exam.type || 'Exame'} ---` });
        if (idx >= 0 && idx < fileBlocks.length && fileBlocks[idx]) {
          blocks.push(fileBlocks[idx]);
        }
      }

      const triageText = await callClaude(TRIAGE_PROMPT, blocks, apiKey, 4096);
      const parts = triageText.split('---PARTE2---');
      const relatorio = (parts[0] || '').trim();
      const resumo = (parts[1] || '').trim();

      let status = 'incomplete';
      if (relatorio.includes('🚨 Pendência crítica')) status = 'critical_pending';
      else if (relatorio.includes('✅ Completo sem alertas')) status = 'complete_without_alerts';
      else if (relatorio.includes('⚠️ Completo com alertas')) status = 'complete_with_alerts';
      else if (relatorio.includes('❌ Incompleto') || relatorio.includes('❌ Pendente')) status = 'incomplete';

      return { patientName: patient.name, surgeryType: patient.surgeryType || 'indefinida', relatorioTecnico: relatorio, blocoResumo: resumo, status };
    });

    const results = await Promise.all(patientPromises);

    // Salvar no banco
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

    return Response.json({ success: true, totalFiles: fileUrls.length, totalPatients: results.length, results });

  } catch (error) {
    console.error('Erro:', error.message);
    return Response.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 });
  }
});