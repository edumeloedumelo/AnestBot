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

async function callClaude(systemPrompt, content, apiKey, maxTokens = 4096, tools = null, toolChoice = null) {
  const body = { model: 'claude-sonnet-4-6', max_tokens: maxTokens, system: systemPrompt, messages: [{ role: 'user', content }] };
  if (tools) { body.tools = tools; body.tool_choice = toolChoice; }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude (${res.status}): ${err.substring(0, 200)}`);
  }
  const data = await res.json();
  // Se há tool_use configurado, retorna o input da tool; senão retorna texto
  if (tools) {
    const toolBlock = (data.content || []).find(c => c.type === 'tool_use');
    if (toolBlock) return toolBlock.input;
    return null;
  }
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

      const identifyTools = [{
        name: 'output_patients',
        description: 'Lista de pacientes identificados nos arquivos',
        input_schema: {
          type: 'object',
          properties: {
            patients: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, surgeryType: { type: 'string' }, examIndices: { type: 'array', items: { type: 'integer' } } }, required: ['name', 'surgeryType', 'examIndices'] } }
          },
          required: ['patients']
        }
      }];
      const json = await callClaude(identifyPrompt, content, apiKey, 2048, identifyTools, { type: 'tool', name: 'output_patients' });
      if (!json) throw new Error('IA não identificou pacientes');

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

      const analyzePrompt = `Médico anestesista — triagem pré-operatória. DIRETO E CONCISO.

Procedimento: ${surgery?.name || patient.surgeryType || 'Não identificado'}
Exames obrigatórios: ${requiredExams.length > 0 ? requiredExams.join(', ') : 'Nenhum'}

REGRAS: Hb ≥ 12. PCR > 10 = alterada. BIRADS 3-6 = mastologista (sem = 🚨). Nódulo RX = pneumologista. GLP-1 = suspender 21d. ECG FC≥50 ok. Urina só ITU. Ilegível = ❓.

LIMITES: ${limitsRef || 'Padrão'}

Retorne via output_analysis. Ultra-compacto.`;

      const analyzeContent = [];
      if (anamnesis?.trim()) {
        analyzeContent.push({ type: 'text', text: `ANAMNESE:\n${anamnesis}\n` });
      }
      const isSingleDoc = patientBlocks.length === 1;
      analyzeContent.push({ type: 'text', text: `${isSingleDoc ? '⚠️ Arquivo único: LEIA TODAS AS PÁGINAS — pode conter múltiplos exames.\n\n' : ''}Analise os ${patientBlocks.length} exames abaixo para a paciente **${patient.name}**. Extraia CADA exame individualmente.` });
      for (let i = 0; i < patientBlocks.length; i++) {
        analyzeContent.push({ type: 'text', text: `--- EXAME [${i}] ---` });
        analyzeContent.push(patientBlocks[i] || { type: 'text', text: '[indisponível]' });
      }

      const analyzeTools = [{
        name: 'output_analysis',
        description: 'Resultado da análise pré-anestésica',
        input_schema: {
          type: 'object',
          properties: {
            patientName: { type: 'string' }, patientInfo: { type: 'string' }, surgeryType: { type: 'string' },
            examResults: { type: 'array', items: { type: 'object', properties: { exam: { type: 'string' }, status: { type: 'string', description: '✅/⚠️/❌/❓' }, value: { type: 'string' } }, required: ['exam', 'status', 'value'] } },
            alerts: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', description: '❌/⚠️/ℹ️' }, text: { type: 'string' } }, required: ['severity', 'text'] } },
            finalStatus: { type: 'string' }, conduct: { type: 'string' }, blocoResumo: { type: 'string', description: 'Bloco RESUMO WhatsApp: nome, alterados/faltando, medicações, alertas críticos. Compacto.' }, relatorioTecnico: { type: 'string' },
            missingExams: { type: 'array', items: { type: 'string' } }, alteredExams: { type: 'array', items: { type: 'string' } },
            medicationsToSuspend: { type: 'array', items: { type: 'object', properties: { medication: { type: 'string' }, period: { type: 'string' } } } }
          },
          required: ['patientName', 'finalStatus']
        }
      }];
      const analyzeResult = await callClaude(analyzePrompt, analyzeContent, apiKey, 3072, analyzeTools, { type: 'tool', name: 'output_analysis' });
      if (!analyzeResult) throw new Error('IA não gerou análise para ' + patient.name);

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