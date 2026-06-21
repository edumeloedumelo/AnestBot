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
  const headRes = await fetch(url, { method: 'HEAD' });
  const contentLength = parseInt(headRes.headers.get('content-length') || '0', 10);
  const MAX_FILE_MB = 100;
  if (contentLength > MAX_FILE_MB * 1024 * 1024) {
    const sizeMB = Math.round(contentLength / (1024 * 1024));
    throw new Error(`Arquivo ${i + 1} excede o limite de ${MAX_FILE_MB}MB (${sizeMB}MB). Comprima ou divida o PDF em arquivos menores.`);
  }
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

    // ===== SINGLE PATIENT — all files belong to ONE patient =====
    const surgeryList = surgeries.map(s => `- ${s.name} → "${s.key}"`).join('\n');
    const surgeryKeys = surgeries.map(s => `"${s.key}"`).join(', ');

    const limitsRef = examLimits.map(e =>
      `- ${e.exam_name}: ${e.description || ''}${e.min_value != null ? ' mín' + e.min_value : ''}${e.max_value != null ? ' máx' + e.max_value : ''}${e.unit ? ' ' + e.unit : ''}`
    ).join('\n');

    const systemPrompt = `Anestesista — triagem pré-operatória. UMA paciente. ULTRACONCISO.

CIRURGIAS CADASTRADAS:
${surgeryKeys}
${surgeryList}

LIMITES DE EXAMES:
${limitsRef || 'Padrão hospitalar'}

REGRAS DE ANÁLISE:

1. CIRURGIA: identifique na anamnese qual cirurgia será realizada. Escolha ENTRE as cadastradas acima.
   Se não houver correspondência clara → surgeryType="indefinida" e alerte o médico.
   NUNCA invente um tipo de cirurgia que não esteja na lista.

2. REVISÃO/REPARO/RETOQUE: se a anamnese indicar REVISÃO de cirurgia anterior (termos: reparo, retoque, revisão, troca de prótese, reconstrução, correção, secundária):
   - DISPENSE todos os exames de imagem e avaliação complementar (USG, Mamografia, RX tórax, ECG, Laudo mastologista, Risco cirúrgico com laudo).
   - A ausência desses exames NÃO gera pendência nem trava.
   - Para exames de sangue, apenas informe há quanto tempo foram feitos (ex: "Hemograma de 15 dias atrás"), sem travar.
   - Sinalize VISIVELMENTE no resultado: isRevision=true.

3. BIRADS (apenas cirurgia de mama NÃO-revisão): BIRADS 1 ou 2 = liberado. BIRADS 3 ou superior = exige laudo do mastologista (🚨 pendência crítica se ausente).

4. ILEGIBILIDADE: se um exame está presente mas ilegível → status="❓", value="Ilegível". Confirme que o documento existe mas não foi possível interpretar. NUNCA invente resultado. NÃO trave por ilegibilidade.

5. EXAMES DE IMAGEM (USG, Mamografia, RX, ECG): são relatórios textuais com laudo médico. PROCURE palavras-chave: "ultrassonografia", "USG", "mamografia", "BI-RADS", "ecografia", "radiografia", "RX", "tórax", "eletrocardiograma", "ECG", "parede abdominal", "abdome". Só marque ❌ se o exame NÃO ESTIVER em nenhum arquivo.

6. OUTRAS REGRAS: Hb≥12. PCR>10=alterado. GLP-1=suspender 21d. Anti-HBs=ignorar(suficiente). ECG FC≥50 ok. Urina só ITU.

FORMATO DE SAÍDA: use output_analysis. Tabela de exames + alertas + bloco WhatsApp. NADA além disso.`;

    // ===== Build content: all files + anamnesis =====
    const content = [];

    // First, ask Claude to identify the surgery from anamnesis
    content.push({
      type: 'text',
      text: `ANAMNESE DA PACIENTE:\n${anamnesis || '(não fornecida)'}\n\nAnalise TODOS os arquivos abaixo como sendo da MESMA paciente.`
    });

    // Then add instructions
    content.push({
      type: 'text',
      text: `INSTRUÇÕES: Identifique a cirurgia na anamnese, avalie cada exame, monte checklist. Ilegível=❓. Revisão=dispensa imagem. NUNCA invente.`
    });

    // Add all files
    for (let i = 0; i < allBlocks.length; i++) {
      content.push({ type: 'text', text: `--- ARQUIVO ${i + 1} ---` });
      content.push(allBlocks[i] || { type: 'text', text: '[indisponível]' });
    }

    const analyzeTools = [{
      name: 'output_analysis',
      description: 'Resultado da triagem pré-anestésica',
      input_schema: {
        type: 'object',
        properties: {
          patientName: { type: 'string', description: 'Nome da paciente' },
          patientInfo: { type: 'string', description: 'Info adicional (idade, IMC, etc.)' },
          surgeryType: { type: 'string', description: 'Tipo de cirurgia (key da lista cadastrada ou "indefinida")' },
          surgeryName: { type: 'string', description: 'Nome legível da cirurgia' },
          isRevision: { type: 'boolean', description: 'TRUE se for reparo/retoque/revisão/troca de prótese/reconstrução' },
          examResults: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                exam: { type: 'string', description: 'Nome do exame' },
                status: { type: 'string', description: '✅ normal | ⚠️ alterado | ❌ ausente | ❓ ilegível | 🚨 crítico' },
                value: { type: 'string', description: 'Resultado ou "Ilegível" ou "Não enviado"' }
              },
              required: ['exam', 'status', 'value']
            }
          },
          alerts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                severity: { type: 'string', description: '🚨/⚠️/ℹ️' },
                text: { type: 'string' }
              },
              required: ['severity', 'text']
            }
          },
          missingExams: { type: 'array', items: { type: 'string' }, description: 'Exames obrigatórios não encontrados (vazio se revisão)' },
          alteredExams: { type: 'array', items: { type: 'string' }, description: 'Exames com alterações' },
          finalStatus: { type: 'string', description: '✅ Completo sem alertas | ⚠️ Completo com alertas | ❌ Exames pendentes | 🚨 Pendência crítica' },
          conduct: { type: 'string', description: 'Conduta recomendada' },
          blocoResumo: { type: 'string', description: 'Bloco de texto pronto para WhatsApp, sem marcadores, com emojis' }
        },
        required: ['patientName', 'surgeryType', 'isRevision', 'finalStatus', 'examResults', 'alerts', 'blocoResumo']
      }
    }];

    const analyzeResult = await callClaude(systemPrompt, content, apiKey, 4096, analyzeTools, { type: 'tool', name: 'output_analysis' });

    if (!analyzeResult) {
      return Response.json({ error: 'Não foi possível analisar os exames. Tente novamente.' }, { status: 422 });
    }

    // NUNCA salvar no banco — processamento em memória, resultado descartado após retorno
    return Response.json({
      result: {
        patientName: analyzeResult.patientName || 'Paciente',
        patientInfo: analyzeResult.patientInfo || '',
        surgeryType: analyzeResult.surgeryType || 'indefinida',
        surgeryName: analyzeResult.surgeryName || analyzeResult.surgeryType || 'Não identificada',
        isRevision: analyzeResult.isRevision || false,
        examResults: analyzeResult.examResults || [],
        alerts: analyzeResult.alerts || [],
        missingExams: analyzeResult.missingExams || [],
        alteredExams: analyzeResult.alteredExams || [],
        finalStatus: analyzeResult.finalStatus || '❌ Pendente',
        conduct: analyzeResult.conduct || '',
        blocoResumo: analyzeResult.blocoResumo || ''
      }
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Erro interno.' }, { status: 500 });
  }
});