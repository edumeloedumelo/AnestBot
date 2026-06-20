import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const CHUNK_SIZE = 4;

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

async function callClaude(systemPrompt, content, apiKey, maxTokens, tools, toolChoice) {
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
  if (tools) {
    const toolBlock = (data.content || []).find(c => c.type === 'tool_use');
    if (toolBlock) return toolBlock.input;
    return null;
  }
  return data.content?.[0]?.text || '';
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

    const allBlocks = await Promise.all(fileUrls.map((url, i) => fetchFileBlock(url, i)));

    // ===== PHASE 1: Identify patients =====
    const keys = surgeries.map(s => `"${s.key}"`).join(', ');
    const surgeryList = surgeries.map(s => `- ${s.name} → "${s.key}"`).join('\n');

    const identifyPrompt = `Identifique pacientes nos exames. Retorne APENAS JSON via output_patients.

Cirurgias: ${keys.length ? keys + ', "combinada", "indefinida"' : '"indefinida"'}
${surgeryList}

Tipos de exame: Hemograma, Coagulograma, Ionograma, Bioquímica renal, Mamografia/USG, Sorologias, Beta-HCG, Urina/EAS, ECG, RX tórax, Risco cirúrgico, USG abdome, USG parede, Outro

IMPORTANTE: PDFs de imagem (USG, Mamografia, RX, ECG) contêm LAUDO MÉDICO em texto. Leia o conteúdo textual do PDF — não ignore só porque tem imagens. Palavras-chave: "ultrassonografia", "USG", "mamografia", "BI-RADS", "RX", "tórax", "ECG", "abdome", "parede abdominal".

Agrupe por nome aproximado. Use anamnese para cirurgia. Na dúvida → "indefinida".
examIndices: índices RELATIVOS (0, 1, 2...).`;

    const chunks = [];
    for (let i = 0; i < fileUrls.length; i += CHUNK_SIZE) {
      chunks.push({ start: i, end: Math.min(i + CHUNK_SIZE, fileUrls.length) });
    }

    const allGroups = [];
    for (const chunk of chunks) {
      const content = [];
      let ctx = `${chunk.end - chunk.start} arquivos. Identifique nome, tipo de exame e cirurgia.`;
      if (chunk.start === 0 && anamnesis?.trim()) {
        ctx += `\nANAMNESE: ${anamnesis}`;
      }
      content.push({ type: 'text', text: ctx });
      for (let i = chunk.start; i < chunk.end; i++) {
        content.push({ type: 'text', text: `--- ARQUIVO [${i - chunk.start}] ---` });
        content.push(allBlocks[i] || { type: 'text', text: '[indisponível]' });
      }
      const identifyTools = [{
        name: 'output_patients',
        description: 'Pacientes identificados',
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
      allGroups.push({
        patients: (json.patients || []).map(p => ({ ...p, examIndices: (p.examIndices || []).map(idx => idx + chunk.start) }))
      });
    }

    const patients = mergePatientGroups(allGroups);
    if (patients.length === 0) {
      return Response.json({ patientsFound: 0, results: [] });
    }

    // ===== PHASE 2: Analyze each patient =====
    const limitsRef = examLimits.map(e =>
      `- ${e.exam_name}: ${e.description || ''}${e.min_value != null ? ' mín' + e.min_value : ''}${e.max_value != null ? ' máx' + e.max_value : ''}${e.unit ? ' ' + e.unit : ''}`
    ).join('\n');

    const results = [];
    for (const patient of patients) {
      const patientBlockIndices = patient.examIndices?.length > 0 ? patient.examIndices : [...Array(fileUrls.length).keys()];

      const surgery = surgeries.find(s => s.key === patient.surgeryType);
      const requiredExams = surgery?.required_exams || [];

      const analyzePrompt = `Anestesista — triagem. ULTRACONCISO. Só checklist + resumo. ZERO explicações.

Procedimento: ${surgery?.name || patient.surgeryType || 'Não identificado'}
Exames obrigatórios: ${requiredExams.length > 0 ? requiredExams.join(', ') : 'Nenhum'}

REGRAS: Hb≥12. PCR>10=alterado. BIRADS 3-6=mastologista(sem=🚨CRÍTICO). Nódulo RX=pneumologista. GLP-1=suspender 21d. Anti-HBs=ignorar(suficiente). Reparo mamário=NÃO exige mamografia. ECG FC≥50 ok. Urina só ITU. Ilegível=❓(nunca inventar). Não enviado=❌.

⚠️ EXAMES DE IMAGEM (USG, Mamografia, RX, ECG): São relatórios textuais com laudo médico. PROCURE por palavras-chave: "ultrassonografia", "USG", "mamografia", "BI-RADS", "ecografia", "radiografia", "RX", "tórax", "eletrocardiograma", "ECG", "parede abdominal", "abdome". Mesmo se o PDF tiver imagens, o LAUDO ESCRITO está presente. Só marque ❌ se o exame NÃO ESTIVER em nenhum arquivo.

LIMITES: ${limitsRef || 'Padrão'}

FORMATO: output_analysis. Checklist + blocoResumo. NADA mais.`;

      const analyzeContent = [];
      const isSingleDoc = patientBlockIndices.length === 1;
      if (anamnesis?.trim()) analyzeContent.push({ type: 'text', text: `ANAMNESE: ${anamnesis}\n` });
      analyzeContent.push({ type: 'text', text: `${isSingleDoc ? '⚠️ LEIA TODAS AS PÁGINAS do PDF.\n' : ''}Paciente: ${patient.name}. CHECKLIST. Sem justificativas. Ilegível=❓. NUNCA inventar.` });
      for (let i = 0; i < patientBlockIndices.length; i++) {
        const idx = patientBlockIndices[i];
        analyzeContent.push({ type: 'text', text: `--- EXAME [${i}] ---` });
        analyzeContent.push(allBlocks[idx] || { type: 'text', text: '[indisponível]' });
      }

      const analyzeTools = [{
        name: 'output_analysis',
        description: 'Análise pré-anestésica',
        input_schema: {
          type: 'object',
          properties: {
            patientName: { type: 'string' }, patientInfo: { type: 'string' }, surgeryType: { type: 'string' },
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
      }];
      const analyzeResult = await callClaude(analyzePrompt, analyzeContent, apiKey, 3072, analyzeTools, { type: 'tool', name: 'output_analysis' });
      if (!analyzeResult) continue;

      // Determine status
      let status = 'incomplete';
      const fs = analyzeResult.finalStatus || '';
      if (fs.includes('crítica') || fs.includes('🚨')) status = 'critical_pending';
      else if (fs.includes('sem alertas') || fs.includes('✅')) status = 'complete_without_alerts';
      else if (fs.includes('com alertas') || fs.includes('⚠️')) status = 'complete_with_alerts';

      // Save to Triage
      await base44.asServiceRole.entities.Triage.create({
        patient_name: analyzeResult.patientName || patient.name,
        surgery_type: analyzeResult.surgeryType || patient.surgeryType || 'indefinida',
        status,
        missing_exams: analyzeResult.missingExams || [],
        altered_exams: analyzeResult.alteredExams || [],
        relatorio_tecnico: '',
        bloco_resumo: analyzeResult.blocoResumo || '',
        files_count: patientBlockIndices.length
      });

      results.push({
        patientName: analyzeResult.patientName,
        patientInfo: analyzeResult.patientInfo || '',
        surgeryType: analyzeResult.surgeryType || patient.surgeryType || 'indefinida',
        examResults: analyzeResult.examResults || [],
        alerts: analyzeResult.alerts || [],
        missingExams: analyzeResult.missingExams || [],
        alteredExams: analyzeResult.alteredExams || [],
        finalStatus: analyzeResult.finalStatus || '❌ Pendente',
        conduct: analyzeResult.conduct || '',
        blocoResumo: analyzeResult.blocoResumo || '',
        relatorioTecnico: '',
        status
      });
    }

    return Response.json({
      patientsFound: patients.length,
      results
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Erro interno.' }, { status: 500 });
  }
});