import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const CHUNK_SIZE = 4; // imagens por lote

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
  const lower = url.toLowerCase();

  if (/\.(png|jpg|jpeg|gif|webp)$/i.test(lower.split('?')[0]) || contentType.startsWith('image/')) {
    const mt = contentType.includes('png') ? 'image/png' : contentType.includes('webp') ? 'image/webp' : contentType.includes('gif') ? 'image/gif' : 'image/jpeg';
    return { type: 'image', source: { type: 'base64', media_type: mt, data: base64 } };
  }
  if (contentType === 'application/pdf' || lower.includes('.pdf')) {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
  }
  return { type: 'text', text: `[Arquivo ${i}]\n${new TextDecoder().decode(buffer).substring(0, 8000)}` };
}

async function callClaude(systemPrompt, content, apiKey, maxTokens = 2048) {
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
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function mergePatientGroups(allGroups) {
  // allGroups: array de {patients: [...]} de cada lote
  const merged = {}; // key: normalized name → {name, surgeryType, examIndices: []}

  for (const group of allGroups) {
    for (const p of (group.patients || [])) {
      const key = normalizeName(p.name || 'paciente nao identificado');
      if (!merged[key]) {
        merged[key] = { name: p.name, surgeryType: p.surgeryType || 'indefinida', examIndices: [] };
      }
      // Adiciona examIndices (já ajustados para o offset do lote)
      for (const idx of (p.examIndices || [])) {
        if (!merged[key].examIndices.includes(idx)) {
          merged[key].examIndices.push(idx);
        }
      }
      // Cirurgia mais específica prevalece
      if (p.surgeryType && p.surgeryType !== 'indefinida' && merged[key].surgeryType === 'indefinida') {
        merged[key].surgeryType = p.surgeryType;
      }
    }
  }

  return Object.values(merged).map(p => ({
    name: p.name,
    surgeryType: p.surgeryType,
    examIndices: p.examIndices.sort((a, b) => a - b)
  }));
}

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const { fileUrls = [], anamnesis } = body;
    if (!fileUrls.length) return Response.json({ error: 'Nenhum arquivo' }, { status: 400 });

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return Response.json({ error: 'API key não configurada' }, { status: 500 });

    const base44 = createClientFromRequest(req);
    const surgeries = await base44.asServiceRole.entities.Surgery.list();
    const keys = surgeries.map(s => `"${s.key}"`).join(', ');
    const list = surgeries.map(s => `- **${s.name}** → key: "${s.key}"`).join('\n');

    const systemPrompt = `Você é um assistente médico. Analise os arquivos e identifique pacientes e tipos de exame.

Retorne APENAS JSON:
{
  "patients": [
    {
      "name": "Nome",
      "surgeryType": ${keys.length ? keys + ' ou "combinada" ou "indefinida"' : '"indefinida"'},
      "examIndices": [0, 1]
    }
  ]
}

Cirurgias: ${list}
Tipos de exame: Hemograma, Coagulograma, Ionograma, Bioquímica renal, Mamografia/USG mamas, Sorologias, Beta-HCG, Urina/EAS, ECG, RX tórax, Risco cirúrgico, USG abdome, USG parede abdominal, Outro
Agrupe por nome aproximado. Use anamnese para cirurgia. Na dúvida → "indefinida".
examIndices: índices RELATIVOS aos arquivos deste lote (0, 1, 2...).`;

    // Baixar TODOS os arquivos primeiro (em paralelo)
    console.log(`Baixando ${fileUrls.length} arquivos...`);
    const allBlocks = await Promise.all(fileUrls.map((url, i) => fetchFileAsBlock(url, i)));

    // Dividir em sub-blocos
    const chunks = [];
    for (let i = 0; i < fileUrls.length; i += CHUNK_SIZE) {
      chunks.push({ start: i, end: Math.min(i + CHUNK_SIZE, fileUrls.length) });
    }

    console.log(`Processando ${chunks.length} sub-blocos de até ${CHUNK_SIZE} arquivos...`);
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

      console.log(`  Sub-bloco ${chunk.start}-${chunk.end - 1}...`);
      const text = await callClaude(systemPrompt, content, apiKey, 2048);
      
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

      let json;
      try {
        json = JSON.parse(cleanJson(text));
      } catch {
        json = JSON.parse(cleanJson((text.match(/\{[\s\S]*\}/) || [text])[0]));
      }

      // Ajustar examIndices: índices relativos → absolutos
      const adjusted = {
        patients: (json.patients || []).map(p => ({
          ...p,
          examIndices: (p.examIndices || []).map(idx => idx + chunk.start)
        }))
      };
      allGroups.push(adjusted);
    }

    // Unir pacientes de todos os sub-blocos
    const patients = mergePatientGroups(allGroups);
    console.log(`${patients.length} pacientes encontrados (total de ${fileUrls.length} arquivos em ${chunks.length} sub-blocos)`);

    return Response.json({ patients });
  } catch (error) {
    console.error('Erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});