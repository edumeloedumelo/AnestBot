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
  const lower = url.toLowerCase().split('?')[0];
  if (/\.(png|jpg|jpeg|gif|webp)$/i.test(lower) || contentType.startsWith('image/')) {
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

    // Prompt único com saída JSON estruturada
    const systemPrompt = `Você é um assistente de triagem pré-anestésica para cirurgias plásticas eletivas.

## CIRURGIAS CADASTRADAS
${surgeries.map(s => `- **${s.name}** → key: "${s.key}" | Exames obrigatórios: ${(s.required_exams || []).join(', ')}`).join('\n')}

## LIMITES CLÍNICOS
${examLimits.map(l => {
  let line = `- **${l.exam_name}**: ${l.description}`;
  if (l.unit) line += ` (${l.unit})`;
  if (l.min_value != null && l.max_value != null) line += ` → ${l.min_value}–${l.max_value} ${l.unit || ''}`;
  else if (l.min_value != null) line += ` → ≥ ${l.min_value} ${l.unit || ''}`;
  else if (l.max_value != null) line += ` → ≤ ${l.max_value} ${l.unit || ''}`;
  if (l.notes) line += `. Obs: ${l.notes}`;
  return line;
}).join('\n')}

## REGRAS CLÍNICAS
- BIRADS 3-6 → obrigatório parecer do mastologista. Sem parecer = 🚨 crítica.
- RX tórax com nódulo → obrigatório pneumologista.
- GLP-1 (Ozempic, Mounjaro, Wegovy, Saxenda): suspender 21 dias antes.
- Ilegível/cortado/desfocado: informe "❓ Ilegível". NUNCA invente resultado.
- Anti-HBs < 2 não contraindica — apenas informe.
- Se exame obrigatório não foi enviado → status "❌ Não enviado".

## FORMATO DE RESPOSTA

Retorne APENAS um JSON válido (sem markdown, sem \`\`\`), com esta estrutura exata:

{
  "patientName": "Nome completo da paciente",
  "patientInfo": "idade, peso/altura, data da cirurgia se disponível",
  "surgeryType": "Nome da cirurgia — \\"key\\"",
  "examResults": [
    {"exam": "Nome do exame", "status": "✅"|"⚠️"|"❌"|"❓", "value": "resultado resumido (ex: Hb 14,0 — normal)"}
  ],
  "alerts": ["Alerta 1", "Alerta 2"],
  "finalStatus": "✅ Completo sem alertas"|"⚠️ Completo com alertas"|"❌ Pendente"|"🚨 Pendência crítica",
  "conduct": "Conduta recomendada em até 3 linhas",
  "blocoResumo": "Resumo curto tipo WhatsApp, máximo 8 linhas, com nome, cirurgia, status, alterados/faltando, suspender, críticos e veredito final",
  "relatorioTecnico": "Relatório técnico completo em texto corrido"
}

IMPORTANTE:
- examResults deve listar TODOS os exames obrigatórios da cirurgia identificada
- Para exames não enviados: status "❌", value "Não enviado"
- Para exames enviados mas ilegíveis: status "❓", value "Ilegível"
- Retorne JSON puro, sem texto antes ou depois.`;

    // Baixar todos os arquivos em paralelo
    console.log(`Baixando ${fileUrls.length} arquivos...`);
    const blocks = await Promise.all(fileUrls.map((url, i) => fetchFileBlock(url, i)));

    const content = [];
    content.push({ type: 'text', text: `Analise TODOS os ${fileUrls.length} exames anexados.${anamnesis.trim() ? '\n\nANAMNESE:\n' + anamnesis : ''}\n\nIdentifique a paciente, o tipo de cirurgia, e para cada exame obrigatório da cirurgia, indique o status (✅ normal, ⚠️ alterado, ❌ não enviado, ❓ ilegível) com o valor resumido. Retorne SOMENTE o JSON.` });

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
    const text = (data.content?.[0]?.text || '').trim();

    // Parse JSON (limpa markdown + repara erros comuns)
    let parsed;
    const cleanJson = (raw) => {
      let s = raw
        .replace(/```json\s*/g, '').replace(/```\s*/g, '')
        .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '') // comentários
        .replace(/,\s*([}\]])/g, '$1') // trailing commas
        .replace(/\n/g, ' ').replace(/\r/g, '')
        .trim();
      // Remove texto antes da primeira { e depois da última }
      const firstBrace = s.indexOf('{');
      const lastBrace = s.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        s = s.substring(firstBrace, lastBrace + 1);
      }
      return s;
    };

    try {
      parsed = JSON.parse(cleanJson(text));
    } catch (e1) {
      // Segunda tentativa: regex extraction com limpeza
      try {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(cleanJson(match[0]));
      } catch (e2) {
        throw new Error(`JSON inválido: ${e2.message}. Resposta crua: ${text.substring(0, 500)}`);
      }
    }

    if (!parsed || !parsed.patientName) {
      throw new Error('Resposta da IA não contém JSON válido: ' + text.substring(0, 300));
    }

    // Determinar status para salvar
    let status = 'incomplete';
    if (parsed.finalStatus?.includes('crítica') || parsed.finalStatus?.includes('🚨')) status = 'critical_pending';
    else if (parsed.finalStatus?.includes('sem alertas') || parsed.finalStatus?.includes('✅')) status = 'complete_without_alerts';
    else if (parsed.finalStatus?.includes('com alertas') || parsed.finalStatus?.includes('⚠️')) status = 'complete_with_alerts';

    // Salvar no banco
    await base44.asServiceRole.entities.Triage.create({
      patient_name: parsed.patientName,
      surgery_type: parsed.surgeryType || 'indefinida',
      status,
      relatorio_tecnico: parsed.relatorioTecnico || '',
      bloco_resumo: parsed.blocoResumo || '',
      files_count: fileUrls.length
    });

    return Response.json({
      patientName: parsed.patientName,
      patientInfo: parsed.patientInfo || '',
      surgeryType: parsed.surgeryType || 'indefinida',
      examResults: parsed.examResults || [],
      alerts: parsed.alerts || [],
      finalStatus: parsed.finalStatus || '❌ Pendente',
      conduct: parsed.conduct || '',
      blocoResumo: parsed.blocoResumo || '',
      relatorioTecnico: parsed.relatorioTecnico || '',
      status
    });
  } catch (error) {
    console.error('Erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});