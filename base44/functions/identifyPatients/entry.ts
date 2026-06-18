import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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

    const prompt = `Você é um assistente médico. Analise os arquivos de exames e identifique pacientes e tipos de exame.

Retorne EXATAMENTE um JSON, sem texto adicional:
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
Agrupe por nome aproximado. Use anamnese para cirurgia. Na dúvida → "indefinida".`;

    // Baixar arquivos
    console.log(`Baixando ${fileUrls.length} arquivos...`);
    const blocks = await Promise.all(fileUrls.map((url, i) => fetchFileAsBlock(url, i)));

    // Montar mensagem
    const content = [];
    let ctx = `Analise os ${fileUrls.length} arquivos. Identifique nome, tipo de exame e cirurgia.`;
    if (anamnesis?.trim()) ctx += `\n\nANAMNESE:\n${anamnesis}`;
    content.push({ type: 'text', text: ctx });
    for (let i = 0; i < blocks.length; i++) {
      content.push({ type: 'text', text: `--- ARQUIVO [${i}] ---` });
      content.push(blocks[i] || { type: 'text', text: `[indisponível]` });
    }

    console.log('Chamando Claude...');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2048, system: prompt, messages: [{ role: 'user', content }] })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Claude (${res.status}): ${err.substring(0, 200)}`);
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const json = JSON.parse((text.match(/\{[\s\S]*\}/) || [text])[0]);

    return Response.json({ patients: json.patients || [] });
  } catch (error) {
    console.error('Erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});