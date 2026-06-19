import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const CHUNK_SIZE = 4;

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    chunks.push(String.fromCharCode(...bytes.slice(i, i + 8192)));
  }
  return btoa(chunks.join(''));
}

async function fetchFileAsBlock(url, i) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const contentType = res.headers.get('content-type') || '';
  const buffer = await res.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  const lower = url.toLowerCase().split('?')[0];

  if (/\.(png|jpg|jpeg|gif|webp)$/i.test(lower) || contentType.startsWith('image/')) {
    const mt = contentType.includes('png') ? 'image/png' : contentType.includes('webp') ? 'image/webp' : contentType.includes('gif') ? 'image/gif' : 'image/jpeg';
    return { type: 'image', source: { type: 'base64', media_type: mt, data: base64 } };
  }
  if (contentType === 'application/pdf' || lower.includes('.pdf')) {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
  }
  return { type: 'text', text: `[Arquivo ${i}]\n${new TextDecoder().decode(buffer).substring(0, 8000)}` };
}

async function callClaude(systemPrompt, content, apiKey, maxTokens = 4096) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, system: systemPrompt, messages: [{ role: 'user', content }] })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude (${res.status}): ${err.substring(0, 200)}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

function normalizeName(name) {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

function mergePatientGroups(allGroups) {
  const merged = {};
  for (const group of allGroups) {
    for (const p of (group.patients || [])) {
      const key = normalizeName(p.name || 'paciente');
      if (!merged[key]) {
        merged[key] = { name: p.name, surgeryType: p.surgeryType || 'indefinida', examIndices: [] };
      }
      for (const idx of (p.examIndices || [])) {
        if (!merged[key].examIndices.includes(idx)) merged[key].examIndices.push(idx);
      }
      if (p.surgeryType && p.surgeryType !== 'indefinida' && merged[key].surgeryType === 'indefinida') {
        merged[key].surgeryType = p.surgeryType;
      }
    }
  }
  return Object.values(merged).map(p => ({ name: p.name, surgeryType: p.surgeryType, examIndices: p.examIndices.sort((a, b) => a - b) }));
}

function extractJson(text) {
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
    // Corrige vírgulas faltando entre elementos
    s = s.replace(/"\s+(?=")/g, (m) => m.includes(',') ? m : '", "');
    s = s.replace(/\}\s+\{/g, '}, {');
    s = s.replace(/\]\s+"/g, '], "');
    s = s.replace(/"\s+\{/g, '", {');
    s = s.replace(/\}\s+"/g, '}, "');
    s = s.replace(/"\s+\[/g, '", [');
    return s;
  };

  try {
    return JSON.parse(cleanJson(text));
  } catch (e1) {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      return JSON.parse(cleanJson(match ? match[0] : text));
    } catch (e2) {
      throw new Error(`JSON inválido: ${e2.message}`);
    }
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { fileUrls, anamnesis } = body;

    if (!fileUrls || fileUrls.length === 0) {
      return Response.json({ error: 'Nenhum arquivo enviado' }, { status: 400 });
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return Response.json({ error: 'API key não configurada' }, { status: 500 });

    const sr = base44.asServiceRole;

    // --- PHASE 1: Identify patients (inline) ---
    const surgeries = await sr.entities.Surgery.list();
    const keys = surgeries.map(s => `"${s.key}"`).join(', ');
    const surgeryList = surgeries.map(s => `- **${s.name}** → key: "${s.key}"`).join('\n');

    const identifyPrompt = `Você é um assistente médico. Analise os arquivos e identifique pacientes e tipos de exame.

Retorne APENAS JSON:
{
  "patients": [
    {
      "name": "Nome da Paciente",
      "surgeryType": ${keys.length ? keys + ' ou "combinada" ou "indefinida"' : '"indefinida"'},
      "examIndices": [0, 1]
    }
  ]
}

Cirurgias conhecidas:\n${surgeryList}

Tipos de exame: Hemograma, Coagulograma, Ionograma, Bioquímica renal, Mamografia/USG mamas, Sorologias, Beta-HCG, Urina/EAS, ECG, RX tórax, Risco cirúrgico, USG abdome, USG parede abdominal, Outro

Agrupe por nome aproximado. Use anamnese para cirurgia. Na dúvida → "indefinida".
examIndices: índices RELATIVOS aos arquivos deste lote (0, 1, 2...).`;

    const allBlocks = await Promise.all(fileUrls.map((url, i) => fetchFileAsBlock(url, i)));

    const chunks = [];
    for (let i = 0; i < fileUrls.length; i += CHUNK_SIZE) {
      chunks.push({ start: i, end: Math.min(i + CHUNK_SIZE, fileUrls.length) });
    }

    const allGroups = [];
    for (const chunk of chunks) {
      const content = [];
      let ctx = `Analise os ${chunk.end - chunk.start} arquivos abaixo. Identifique nome, tipo de exame e cirurgia.`;
      if (chunk.start === 0 && anamnesis?.trim()) {
        ctx += `\n\nANAMNESE:\n${anamnesis}`;
      }
      content.push({ type: 'text', text: ctx });

      for (let i = chunk.start; i < chunk.end; i++) {
        content.push({ type: 'text', text: `--- ARQUIVO [${i - chunk.start}] ---` });
        content.push(allBlocks[i] || { type: 'text', text: `[indisponível]` });
      }

      const text = await callClaude(identifyPrompt, content, apiKey, 2048);
      const json = extractJson(text);

      const adjusted = {
        patients: (json.patients || []).map(p => ({
          ...p,
          examIndices: (p.examIndices || []).map(idx => idx + chunk.start)
        }))
      };
      allGroups.push(adjusted);
    }

    const patients = mergePatientGroups(allGroups);

    if (patients.length === 0) {
      return Response.json({ message: 'Nenhum paciente identificado', patientsFound: 0 });
    }

    // --- PHASE 2: Analyze each patient (inline) ---
    const examLimits = await sr.entities.ExamLimit.list();

    const results = [];
    for (const patient of patients) {
      const patientFileUrls = (patient.examIndices || []).map(i => fileUrls[i]).filter(Boolean);
      const filesToAnalyze = patientFileUrls.length > 0 ? patientFileUrls : fileUrls;

      const patientBlocks = [];
      const fileIndices = patient.examIndices?.length > 0 ? patient.examIndices : [...Array(fileUrls.length).keys()];
      for (const idx of fileIndices) {
        patientBlocks.push(allBlocks[idx]);
      }

      if (patientBlocks.filter(Boolean).length === 0) continue;

      // Build surgery exam requirements
      const surgery = surgeries.find(s => s.key === patient.surgeryType);
      const requiredExams = surgery?.required_exams || [];

      // Build exam limits reference
      const limitsRef = examLimits.map(e => 
        `- ${e.exam_name}: ${e.description || ''} (${e.rule_type || ''}) ${e.min_value != null ? 'mín ' + e.min_value : ''}${e.max_value != null ? ' máx ' + e.max_value : ''} ${e.unit || ''}`
      ).join('\n');

      const analyzePrompt = `Você é um médico especialista em avaliação pré-anestésica para cirurgias plásticas eletivas.

REGRAS INEGOCIÁVEIS:
1. Compare CADA exame com seus valores de referência. NÃO ignore exames com valores alterados.
2. Se um exame obrigatório estiver ausente, marque-o como faltante e o status final DEVE ser "incomplete".
3. NÃO marque exames com valores alterados como "ok" ou "normal".
4. Para cada exame alterado, gere um ALERTA claro.
5. Siga a conduta baseada na QUANTIDADE de exames alterados e na GRAVIDADE das alterações.

Procedimento: **${surgery?.name || patient.surgeryType || 'Não identificado'}**
Exames obrigatórios: ${requiredExams.length > 0 ? requiredExams.join(', ') : 'Nenhum definido'}

VALORES DE REFERÊNCIA:
${limitsRef || 'Usar valores de referência padrão da literatura médica'}

STATUS FINAL (use exatamente um destes):
- "complete_without_alerts": todos exames obrigatórios presentes e NORMAIS
- "complete_with_alerts": exames presentes mas com ALTERAÇÕES
- "incomplete": exames obrigatórios FALTANDO

CONDUTA:
- Sem alertas e sem faltantes: "✅ Paciente apta para cirurgia. Prosseguir conforme protocolo."
- Até 2 alertas leves: "⚠️ Paciente requer avaliação adicional. Solicitar [exames]."
- 3+ alertas ou alerta grave: "❌ Contraindicada para cirurgia eletiva no momento. Encaminhar para [especialidade]."
- Exames faltantes: "📋 Exames pendentes: [lista]. Solicitar antes da avaliação."

RETORNE APENAS JSON:
{
  "patientName": "Nome",
  "patientInfo": "idade, IMC, comorbidades",
  "surgeryType": "${patient.surgeryType || 'indefinida'}",
  "examResults": [
    {"exam": "Hemoglobina", "result": "12.5 g/dL", "reference": "12-16 g/dL", "status": "normal", "notes": ""}
  ],
  "alerts": [
    {"exam": "Hemoglobina", "rule": "Mínimo 12 g/dL", "value": "10.2 g/dL", "limit": "≥ 12 g/dL", "severity": "moderada"}
  ],
  "finalStatus": "complete_without_alerts",
  "conduct": "✅ Paciente apta...",
  "blocoResumo": "Resumo curto para WhatsApp (máx 300 caracteres)",
  "relatorioTecnico": "Relatório técnico completo para o prontuário",
  "missingExams": ["Beta-HCG"],
  "alteredExams": ["Hemoglobina"]
}`;

      const analyzeContent = [];
      if (anamnesis?.trim()) {
        analyzeContent.push({ type: 'text', text: `ANAMNESE:\n${anamnesis}\n` });
      }
      analyzeContent.push({ type: 'text', text: `Analise os ${patientBlocks.length} exames abaixo para a paciente **${patient.name}**.` });
      for (let i = 0; i < patientBlocks.length; i++) {
        analyzeContent.push({ type: 'text', text: `--- EXAME [${i}] ---` });
        analyzeContent.push(patientBlocks[i] || { type: 'text', text: '[indisponível]' });
      }

      const analyzeText = await callClaude(analyzePrompt, analyzeContent, apiKey, 4096);
      const analyzeResult = extractJson(analyzeText);

      // Save Triage record
      await sr.entities.Triage.create({
        patient_name: analyzeResult.patientName || patient.name || 'Não identificado',
        surgery_type: analyzeResult.surgeryType || patient.surgeryType || 'indefinida',
        status: analyzeResult.finalStatus || 'complete_without_alerts',
        missing_exams: analyzeResult.missingExams || [],
        altered_exams: analyzeResult.alteredExams || [],
        relatorio_tecnico: analyzeResult.relatorioTecnico || '',
        bloco_resumo: analyzeResult.blocoResumo || '',
        files_count: fileUrls.length,
        notes: anamnesis || ''
      });

      results.push(analyzeResult);
    }

    return Response.json({
      success: true,
      patientsFound: patients.length,
      resultsAnalyzed: results.length,
      results
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});