import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const MAX_FILE_MB = 100;
const MAX_TOKENS_P1 = 512;
const MAX_TOKENS_P2 = 4096;
const MODEL = 'claude-sonnet-4-6';

const IMAGING_PATTERNS = /mamografia|usg|ultrassom|ultra.som|rx|radiografia|ecg|eletrocardiograma|laudo|imagem|tomografia|ressonância|mastologista|ecocardiograma/i;

async function streamToBase64(body) {
  const reader = body.getReader();
  const chunks = [];
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
      chunks.push(btoa(binary));
    }
    leftover = combined.slice(processLen);
  }
  if (leftover.length > 0) {
    let binary = '';
    for (let j = 0; j < leftover.length; j++) binary += String.fromCharCode(leftover[j]);
    chunks.push(btoa(binary));
  }
  return chunks.join('');
}

async function fetchFileBlock(url, i) {
  const headRes = await fetch(url, { method: 'HEAD' });
  const contentLength = parseInt(headRes.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_FILE_MB * 1024 * 1024) {
    const sizeMB = Math.round(contentLength / (1024 * 1024));
    throw new Error(`Arquivo ${i + 1} excede o limite de ${MAX_FILE_MB}MB (${sizeMB}MB).`);
  }

  const res = await fetch(url);
  if (!res.ok) return null;
  const contentType = res.headers.get('content-type') || '';
  const cleanUrl = url.split('?')[0].toLowerCase();
  const isPdf = contentType === 'application/pdf' || cleanUrl.endsWith('.pdf');
  const isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(cleanUrl) || contentType.startsWith('image/');

  if (isImage || isPdf) {
    const base64 = await streamToBase64(res.body);
    if (isImage) {
      const mt = contentType.includes('png') ? 'image/png' : contentType.includes('webp') ? 'image/webp' : contentType.includes('gif') ? 'image/gif' : 'image/jpeg';
      return { type: 'image', source: { type: 'base64', media_type: mt, data: base64 } };
    }
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
  }
  const buffer = await res.arrayBuffer();
  return { type: 'text', text: `[Arquivo ${i + 1}]\n${new TextDecoder().decode(buffer).substring(0, 8000)}` };
}

async function callClaude(systemPrompt, content, apiKey, maxTokens, tools, toolChoice) {
  const body = { model: MODEL, max_tokens: maxTokens, system: systemPrompt, messages: [{ role: 'user', content }] };
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

    // Load config in parallel
    const [surgeries, examLimits] = await Promise.all([
      base44.asServiceRole.entities.Surgery.list(),
      base44.asServiceRole.entities.ExamLimit.list()
    ]);

    // ===== PHASE 1: Identify surgery and mode =====
    const surgeryList = surgeries.map(s => `- ${s.name} → key: "${s.key}"`).join('\n');
    const surgeryKeys = surgeries.map(s => `"${s.key}"`).join(', ');

    const phase1Prompt = `Você é um assistente de triagem pré-anestésica. Identifique APENAS a cirurgia e o modo.

## CIRURGIAS CADASTRADAS:
${surgeryList}

## SUA TAREFA:
1. Leia a anamnese.
2. Determine qual cirurgia (key) corresponde. Use EXATAMENTE uma das keys: ${surgeryKeys}.
3. Determine se é REVISÃO/REPARO/RETOQUE (is_revision=true): a anamnese menciona reparo, retoque, revisão, cirurgia secundária, correção de procedimento anterior, troca de prótese, ajuste?
4. Se não identificar → surgery_key=null + explique o motivo em português.

Retorne APENAS via tool use.`;

    const phase1Content = [{ type: 'text', text: `ANAMNESE:\n${anamnesis || '(vazia)'}` }];

    const phase1Tools = [{
      name: 'output_surgery',
      description: 'Cirurgia identificada',
      input_schema: {
        type: 'object',
        properties: {
          surgery_key: { type: ['string', 'null'], description: 'Key exata da cirurgia, ou null' },
          is_revision: { type: 'boolean', description: 'True se revisão/reparo/retoque' },
          not_found_reason: { type: 'string', description: 'Explicação se surgery_key for null' }
        },
        required: ['surgery_key', 'is_revision']
      }
    }];

    const p1Result = await callClaude(phase1Prompt, phase1Content, apiKey, MAX_TOKENS_P1, phase1Tools, { type: 'tool', name: 'output_surgery' });

    if (!p1Result || !p1Result.surgery_key) {
      const reason = (p1Result?.not_found_reason) || 'Não foi possível identificar a cirurgia na anamnese.';
      return Response.json({
        error: 'Cirurgia não identificada',
        not_found_reason: reason,
        status: 422
      }, { status: 422 });
    }

    const surgery = surgeries.find(s => s.key === p1Result.surgery_key);
    const surgeryName = surgery?.name || p1Result.surgery_key;
    const isRevision = !!p1Result.is_revision;

    // ===== PHASE 2: Analyze exams =====
    const allBlocks = await Promise.all(fileUrls.map((url, i) => fetchFileBlock(url, i)));

    // Filter required exams for revision
    let requiredExams = surgery?.required_exams || [];
    let revisionBlock = '';

    if (isRevision) {
      requiredExams = requiredExams.filter(e => !IMAGING_PATTERNS.test(e));
      revisionBlock = `══ PROCEDIMENTO DE REVISÃO/REPARO/RETOQUE — REGIME ESPECIAL ══
- Exames de imagem e avaliações complementares (USG, mamografia, laudo de mastologista, RX de tórax, ECG) NÃO são obrigatórios e NÃO geram pendência por ausência.
- BIRADS: regra de obrigatoriedade de laudo NÃO se aplica neste procedimento.
- Exames de sangue: para CADA exame de sangue encontrado, extraia e informe OBRIGATORIAMENTE a data de coleta. Calcule há quantos dias/meses foi realizado. Exiba assim: "Hb 13.2 g/dL · coleta: 10/03/2025 (há 3 meses)". Se a data não estiver legível, escreva "data ilegível". Se parecer desatualizado (>90 dias), sinalize com ℹ️. NUNCA trave por exame de sangue desatualizado — apenas informe.
- Nunca coloque ausência de exame de imagem como ❌ ou como motivo de status "pendente" ou "crítico".
══════════════════════════════════════════════════════════════`;
    }

    const limitsRef = examLimits.map(e =>
      `- ${e.exam_name}: ${e.description || ''}${e.min_value != null ? ' mín ' + e.min_value : ''}${e.max_value != null ? ' máx ' + e.max_value : ''}${e.unit ? ' ' + e.unit : ''}`
    ).join('\n');

    const phase2Prompt = `Anestesista — triagem pré-anestésica. ULTRACONCISO. Checklist + tabela + resumo. ZERO explicações longas.

## PROCEDIMENTO
Nome: ${surgeryName}
Key: ${p1Result.surgery_key}
Exames obrigatórios: ${requiredExams.length > 0 ? requiredExams.join(', ') : 'Nenhum'}
${isRevision ? 'MODO: REVISÃO/REPARO/RETOQUE' : 'MODO: CIRURGIA PRIMÁRIA'}

${revisionBlock}

## LIMITES DE REFERÊNCIA
${limitsRef || 'Padrão clínico'}

## REGRAS CLÍNICAS
- Ilegibilidade: exame presente mas ilegível → ❓, texto "presente mas ilegível — não foi possível interpretar". Nunca invente.
- Ausente (não enviado): ❌ · Alterado: ⚠️ · Normal: ✅
- Hb < 12 g/dL → ⚠️
- PCR > 10 mg/L → ⚠️
- Anti-HBs: ignorar (suficiência vacinal — não gera pendência)
- GLP-1 (Ozempic, Mounjaro, Wegovy, etc): suspender 21 dias — se em uso sem suspensão confirmada, gerar alerta
- ECG: FC ≥ 50 bpm é aceitável
- Urina/EAS: relevante apenas para ITU${!isRevision ? `\n- BIRADS 1 ou 2: ✅ liberado · BIRADS 3/4/5/6: exige laudo do mastologista. Sem laudo → 🚨 PENDÊNCIA CRÍTICA` : ''}

⚠️ EXAMES DE IMAGEM (USG, Mamografia, RX, ECG): São relatórios textuais com laudo médico. PROCURE: "ultrassonografia", "USG", "mamografia", "BI-RADS", "ecografia", "radiografia", "RX", "tórax", "eletrocardiograma", "ECG".
NUNCA invente, presuma ou chute resultado, valor ou laudo.

## FORMATO DE SAÍDA — relatorioTabela
Tabela markdown OBRIGATÓRIA:
| Exame | Status | Valor/Observação |
|---|---|---|
${isRevision ? '| 🔄 REVISÃO/REPARO | — | Exames de imagem, RX e ECG dispensados neste procedimento |\n' : ''}| Hemograma | ✅ | Hb 13.5 g/dL · coleta: 10/03/2025 (há 3 meses) |
| Mamografia | 🚨 | BIRADS 4 — laudo de mastologista não encontrado |
| RX Tórax | ❌ | Não enviado |
| ECG | ❓ | Presente mas ilegível |

Uma linha por exame. Emojis obrigatórios. Sem parágrafos. Sem justificativas longas.

## medicationsToSuspend
Array de { medication: string, suspend: string }. Ex: { medication: "Ozempic", suspend: "21 dias antes da cirurgia" }.
Se nenhuma → array vazio.

Retorne TUDO via output_analysis.`;

    const phase2Content = [];
    phase2Content.push({ type: 'text', text: `ANAMNESE: ${anamnesis || '(não informada)'}\n\nAnalise os ${fileUrls.length} arquivos abaixo. Gere a tabela completa.` });
    for (let i = 0; i < allBlocks.length; i++) {
      phase2Content.push({ type: 'text', text: `--- ARQUIVO [${i + 1}] ---` });
      phase2Content.push(allBlocks[i] || { type: 'text', text: '[indisponível]' });
    }

    const phase2Tools = [{
      name: 'output_analysis',
      description: 'Análise pré-anestésica completa',
      input_schema: {
        type: 'object',
        properties: {
          patientName: { type: 'string' },
          patientInfo: { type: 'string' },
          surgeryType: { type: 'string' },
          relatorioTabela: { type: 'string', description: 'Tabela markdown completa com exames' },
          examResults: { type: 'array', items: { type: 'object', properties: { exam: { type: 'string' }, status: { type: 'string' }, value: { type: 'string' } }, required: ['exam', 'status', 'value'] } },
          alerts: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string' }, text: { type: 'string' } }, required: ['severity', 'text'] } },
          missingExams: { type: 'array', items: { type: 'string' } },
          alteredExams: { type: 'array', items: { type: 'string' } },
          medicationsToSuspend: { type: 'array', items: { type: 'object', properties: { medication: { type: 'string' }, suspend: { type: 'string' } }, required: ['medication', 'suspend'] } },
          finalStatus: { type: 'string' },
          conduct: { type: 'string' },
          blocoResumo: { type: 'string' },
          unsupportedFilesNote: { type: 'string' }
        },
        required: ['patientName', 'surgeryType', 'finalStatus', 'relatorioTabela', 'examResults', 'blocoResumo']
      }
    }];

    const p2Result = await callClaude(phase2Prompt, phase2Content, apiKey, MAX_TOKENS_P2, phase2Tools, { type: 'tool', name: 'output_analysis' });

    if (!p2Result) {
      return Response.json({ error: 'Não foi possível analisar os exames. Tente novamente.' }, { status: 500 });
    }

    let status = 'incomplete';
    const fs = p2Result.finalStatus || '';
    if (fs.includes('🚨')) status = 'critical_pending';
    else if (fs.includes('✅')) status = 'complete_without_alerts';
    else if (fs.includes('⚠️')) status = 'complete_with_alerts';

    return Response.json({
      patientName: p2Result.patientName || 'Paciente',
      patientInfo: p2Result.patientInfo || '',
      surgeryName,
      surgeryType: p1Result.surgery_key,
      isRevision,
      relatorioTabela: p2Result.relatorioTabela || '',
      examResults: p2Result.examResults || [],
      alerts: p2Result.alerts || [],
      missingExams: p2Result.missingExams || [],
      alteredExams: p2Result.alteredExams || [],
      medicationsToSuspend: p2Result.medicationsToSuspend || [],
      finalStatus: p2Result.finalStatus || '❌ Pendente',
      conduct: p2Result.conduct || '',
      blocoResumo: p2Result.blocoResumo || '',
      unsupportedFilesNote: p2Result.unsupportedFilesNote || '',
      status
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Erro interno.' }, { status: 500 });
  }
});