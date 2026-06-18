import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    chunks.push(String.fromCharCode(...bytes.slice(i, i + 8192)));
  }
  return btoa(chunks.join(''));
}

async function fetchFileAsBlock(url, label) {
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
  return { type: 'text', text: `[${label}]\n${new TextDecoder().decode(buffer).substring(0, 8000)}` };
}

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const { fileUrls = [], patientName, surgeryType, anamnesis } = body;
    if (!fileUrls.length || !patientName) {
      return Response.json({ error: 'Dados incompletos' }, { status: 400 });
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return Response.json({ error: 'API key não configurada' }, { status: 500 });

    const base44 = createClientFromRequest(req);
    const [surgeries, examLimits] = await Promise.all([
      base44.asServiceRole.entities.Surgery.list(),
      base44.asServiceRole.entities.ExamLimit.list()
    ]);

    // Montar prompt do sistema
    let surgSection = '';
    for (const s of surgeries) {
      surgSection += `### ${s.name} (key: "${s.key}")\n${(s.required_exams || []).join(' · ')}\n\n`;
    }
    let limSection = '';
    for (const l of examLimits) {
      let line = `- **${l.exam_name}**: ${l.description}`;
      if (l.unit) line += ` (${l.unit})`;
      if (l.notes) line += `. Obs: ${l.notes}`;
      limSection += line + '\n';
    }

    const systemPrompt = `Você é um assistente de triagem pré-anestésica para cirurgias plásticas eletivas. Raciocínio técnico, rigoroso e conservador.

## CIRURGIAS E EXAMES
${surgSection}
### Cirurgias combinadas — exigir TODOS os exames de TODOS os procedimentos.

## LIMITES
${limSection}

## REGRAS
- Mama/BIRADS: 1-2 ok. 3-6 → mastologista + parecer. Sem parecer = 🚨 crítica.
- RX tórax: nódulo → pneumologista.
- Anti-HBs < 2 não contraindica.
- GLP-1 (Ozempic, Mounjaro, etc): suspender 21d.
- Ilegível/cortado/desfocado: informe que não foi possível validar. NUNCA invente.
- NUNCA: inventar resultado, presumir BIRADS/ECG, ignorar Hb<12, nódulo, medicação, exame obrigatório.

## RESPOSTA (duas partes separadas por ---PARTE2---)

PARTE 1:
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

PARTE 2:
\`\`\`
📋 RESUMO — TRIAGEM PRÉ-ANESTÉSICA
🧍‍♀️ Nome: [nome] | 🔪 Cirurgia: [tipo]
🔬 Alterados/faltando: [listar ou "nenhum ✅"]
💊 Suspender: [listar ou "nenhuma ✅"]
🚨 Críticos: [listar ou "nenhum ✅"]
📌 [✅ liberado / ⚠️ com ressalvas / ❌ pendente / 🚨 não liberar]
\`\`\``;

    // Baixar arquivos deste paciente
    const blocks = await Promise.all(fileUrls.map((url, i) => fetchFileAsBlock(url, `Exame ${i + 1}`)));

    // Montar mensagem
    const content = [];
    content.push({ type: 'text', text: `Paciente: ${patientName}\nCirurgia: ${surgeryType || 'indefinida'}${anamnesis?.trim() ? '\nAnamnese: ' + anamnesis : ''}\n\nAnalise os exames abaixo.` });
    for (let i = 0; i < blocks.length; i++) {
      content.push({ type: 'text', text: `--- EXAME [${i + 1}] ---` });
      content.push(blocks[i] || { type: 'text', text: `[indisponível]` });
    }

    console.log(`Triagem: ${patientName} (${fileUrls.length} exames)...`);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4096, system: systemPrompt, messages: [{ role: 'user', content }] })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Claude (${res.status}): ${err.substring(0, 200)}`);
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const parts = text.split('---PARTE2---');
    const relatorio = (parts[0] || '').trim();
    const resumo = (parts[1] || '').trim();

    let status = 'incomplete';
    if (relatorio.includes('🚨 Pendência crítica')) status = 'critical_pending';
    else if (relatorio.includes('✅ Completo sem alertas')) status = 'complete_without_alerts';
    else if (relatorio.includes('⚠️ Completo com alertas')) status = 'complete_with_alerts';

    // Salvar
    await base44.asServiceRole.entities.Triage.create({
      patient_name: patientName,
      surgery_type: surgeryType || 'indefinida',
      status,
      relatorio_tecnico: relatorio,
      bloco_resumo: resumo,
      files_count: fileUrls.length
    });

    return Response.json({ patientName, surgeryType: surgeryType || 'indefinida', relatorioTecnico: relatorio, blocoResumo: resumo, status });
  } catch (error) {
    console.error('Erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});