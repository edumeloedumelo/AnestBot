import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    chunks.push(String.fromCharCode(...bytes.slice(i, i + 8192)));
  }
  return btoa(chunks.join(''));
}

async function fetchFileBlock(url, i) {
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
  return { type: 'text', text: `[Arquivo ${i + 1}]\n${new TextDecoder().decode(buffer).substring(0, 8000)}` };
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

    // Prompt único: identifica + analisa em uma tacada
    const systemPrompt = `Você é um assistente de triagem pré-anestésica para cirurgias plásticas eletivas.

## CIRURGIAS
${surgeries.map(s => `- **${s.name}** → key: "${s.key}" | Exames: ${(s.required_exams || []).join(', ')}`).join('\n')}

## LIMITES
${limSection || 'Nenhum limite cadastrado.'}

## REGRAS
- BIRADS 3-6 → mastologista. Sem parecer = 🚨 crítica.
- RX tórax com nódulo → pneumologista.
- GLP-1 (Ozempic, Mounjaro): suspender 21d.
- Ilegível/cortado/desfocado: informe. NUNCA invente resultado.
- Anti-HBs < 2 não contraindica.

## FORMATO DE RESPOSTA

Retorne EXATAMENTE neste formato (duas partes separadas por ---PARTE2---):

PARTE 1 — Relatório Técnico:
\`\`\`
🧾 TRIAGEM PRÉ-OPERATÓRIA
👩‍⚕️ Paciente: [nome]
🔪 Cirurgia: [tipo + key entre aspas]
📋 Exames obrigatórios: [✅/⚠️/❌ por exame]
🚨 ALTERAÇÕES: [listar ou "✅ Sem alterações"]
📌 STATUS: ✅ Completo sem alertas / ⚠️ Completo com alertas / ❌ Pendente / 🚨 Pendência crítica
📋 CONDUTA: [até 3 linhas]
\`\`\`

PARTE 2 — Resumo WhatsApp:
\`\`\`
📋 RESUMO — TRIAGEM PRÉ-ANESTÉSICA
🧍‍♀️ Nome: [nome] | 🔪 Cirurgia: [tipo]
🔬 Alterados/faltando: [listar ou "nenhum ✅"]
💊 Suspender: [listar ou "nenhuma ✅"]
🚨 Críticos: [listar ou "nenhum ✅"]
📌 [✅ liberado / ⚠️ com ressalvas / ❌ pendente / 🚨 não liberar]
\`\`\``;

    // Baixar todos os arquivos em paralelo
    console.log(`Baixando ${fileUrls.length} arquivos...`);
    const blocks = await Promise.all(fileUrls.map((url, i) => fetchFileBlock(url, i)));

    // Montar mensagem única
    const content = [];
    content.push({ type: 'text', text: `Analise TODOS os ${fileUrls.length} exames abaixo.${anamnesis.trim() ? '\n\nANAMNESE:\n' + anamnesis : ''}\n\nPrimeiro identifique a paciente e o tipo de cirurgia, depois analise cada exame contra os limites.` });

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (!b) {
        content.push({ type: 'text', text: `--- EXAME [${i + 1}]: indisponível ---` });
      } else {
        content.push({ type: 'text', text: `--- EXAME [${i + 1}] ---` });
        content.push(b);
      }
    }

    console.log('Chamando Claude...');
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4096, system: systemPrompt, messages: [{ role: 'user', content }] })
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      throw new Error(`Claude (${claudeRes.status}): ${err.substring(0, 200)}`);
    }

    const data = await claudeRes.json();
    const text = data.content?.[0]?.text || '';
    const parts = text.split('---PARTE2---');
    const relatorio = (parts[0] || '').trim();
    const resumo = (parts[1] || '').trim();

    // Extrair nome e cirurgia do relatório
    const nameMatch = relatorio.match(/Paciente:\s*([^\n]+)/);
    const surgMatch = relatorio.match(/Cirurgia:\s*([^\n]+)/);
    const patientName = nameMatch ? nameMatch[1].trim() : 'Paciente';
    const surgeryType = surgMatch ? surgMatch[1].trim() : 'indefinida';

    // Status
    let status = 'incomplete';
    if (relatorio.includes('🚨 Pendência crítica') || relatorio.includes('não liberar')) status = 'critical_pending';
    else if (relatorio.includes('✅ Completo sem alertas') || relatorio.includes('✅ liberado')) status = 'complete_without_alerts';
    else if (relatorio.includes('⚠️ Completo com alertas') || relatorio.includes('⚠️ com ressalvas')) status = 'complete_with_alerts';

    // Salvar
    await base44.asServiceRole.entities.Triage.create({
      patient_name: patientName,
      surgery_type: surgeryType,
      status,
      relatorio_tecnico: relatorio,
      bloco_resumo: resumo,
      files_count: fileUrls.length
    });

    return Response.json({
      patientName,
      surgeryType,
      relatorioTecnico: relatorio,
      blocoResumo: resumo,
      status
    });
  } catch (error) {
    console.error('Erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});