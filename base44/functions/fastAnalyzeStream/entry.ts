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

    // Construir prompt
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

## REGRAS
- BIRADS 3-6 → parecer do mastologista obrigatório. Sem parecer = 🚨 crítica.
- RX tórax com nódulo → pneumologista obrigatório.
- GLP-1: suspender 21 dias antes.
- Ilegível/cortado/desfocado: informe "❓ Ilegível". NUNCA invente.
- Exame obrigatório não enviado → "❌ Não enviado".

## FORMATO DE RESPOSTA
Retorne APENAS JSON válido (sem markdown):
{
  "phase1": {
    "patientName": "Nome",
    "patientInfo": "idade, peso/altura, data",
    "surgeryType": "Cirurgia — key"
  },
  "phase2": {
    "examResults": [{"exam":"...", "status":"✅|⚠️|❌|❓", "value":"..."}],
    "alerts": ["..."],
    "finalStatus": "✅ Completo sem alertas|⚠️ Completo com alertas|❌ Pendente|🚨 Pendência crítica",
    "conduct": "...",
    "blocoResumo": "...",
    "relatorioTecnico": "..."
  }
}

IMPORTANTE: Gere phase1 PRIMEIRO (antes de analisar os exames), depois phase2. Assim consigo exibir o paciente enquanto os exames são processados.`;

    // Baixar arquivos
    console.log(`Baixando ${fileUrls.length} arquivos...`);
    const blocks = await Promise.all(fileUrls.map((url, i) => fetchFileBlock(url, i)));

    const content = [];
    content.push({ type: 'text', text: `Analise TODOS os ${fileUrls.length} exames.${anamnesis.trim() ? '\n\nANAMNESE:\n' + anamnesis : ''}\n\nRetorne SOMENTE o JSON com phase1 e phase2.` });
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (!b) continue;
      content.push({ type: 'text', text: `--- EXAME [${i + 1}] ---` });
      content.push(b);
    }

    // Criar stream SSE
    let bodyCancelled = false;
    let finalResult = null;

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (data) => {
          if (bodyCancelled) return;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        (async () => {
          try {
            send({ type: 'progress', phase: 'analyzing', message: 'IA analisando exames...' });

            const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
              body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4096, stream: true, system: systemPrompt, messages: [{ role: 'user', content }] })
            });

            if (!claudeRes.ok) {
              const err = await claudeRes.text();
              send({ type: 'error', error: `Claude (${claudeRes.status}): ${err.substring(0, 200)}` });
              controller.close();
              return;
            }

            let fullText = '';
            let phase1Sent = false;
            let lastPhase2Sent = '';
            const reader = claudeRes.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6);
                if (data === '[DONE]') continue;

                try {
                  const parsed = JSON.parse(data);
                  if (parsed.type === 'content_block_delta') {
                    fullText += parsed.delta?.text || '';

                    // Tentar extrair phase1
                    if (!phase1Sent) {
                      const p1Match = fullText.match(/"phase1"\s*:\s*(\{[^}]+\})/s);
                      if (p1Match) {
                        try {
                          const p1 = JSON.parse(p1Match[1]);
                          send({ type: 'phase1', ...p1 });
                          phase1Sent = true;
                        } catch {}
                      }
                    }

                    // Tentar extrair phase2 parcial
                    if (phase1Sent) {
                      const p2Match = fullText.match(/"phase2"\s*:\s*(\{[\s\S]*?\})(?:\s*\}|$)/);
                      if (p2Match) {
                        const p2Text = p2Match[1];
                        if (p2Text !== lastPhase2Sent && p2Text.length > 20) {
                          try {
                            const p2 = JSON.parse(p2Text);
                            // Só envia se tiver pelo menos alguns exames
                            if (p2.examResults && p2.examResults.length >= 2) {
                              send({ type: 'phase2_partial', ...p2 });
                              lastPhase2Sent = p2Text;
                            }
                          } catch {}
                        }
                      }
                    }
                  }
                } catch {}
              }
            }

            // Parse final completo
            try {
              const clean = fullText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
              finalResult = JSON.parse(clean);
            } catch {
              const match = fullText.match(/\{[\s\S]*\}/);
              if (match) finalResult = JSON.parse(match[0]);
            }

            if (!finalResult?.phase1?.patientName) {
              send({ type: 'error', error: 'Não foi possível extrair dados da resposta da IA.' });
              controller.close();
              return;
            }

            // Salvar no banco
            const p1 = finalResult.phase1;
            const p2 = finalResult.phase2 || {};
            let status = 'incomplete';
            const fs = p2.finalStatus || '';
            if (fs.includes('crítica') || fs.includes('🚨')) status = 'critical_pending';
            else if (fs.includes('sem alertas') || fs.includes('✅')) status = 'complete_without_alerts';
            else if (fs.includes('com alertas') || fs.includes('⚠️')) status = 'complete_with_alerts';

            await base44.asServiceRole.entities.Triage.create({
              patient_name: p1.patientName,
              surgery_type: p1.surgeryType || 'indefinida',
              status,
              relatorio_tecnico: p2.relatorioTecnico || '',
              bloco_resumo: p2.blocoResumo || '',
              files_count: fileUrls.length
            });

            // Enviar resultado completo
            send({
              type: 'complete',
              patientName: p1.patientName,
              patientInfo: p1.patientInfo || '',
              surgeryType: p1.surgeryType || '',
              examResults: p2.examResults || [],
              alerts: p2.alerts || [],
              finalStatus: p2.finalStatus || '❌ Pendente',
              conduct: p2.conduct || '',
              blocoResumo: p2.blocoResumo || '',
              relatorioTecnico: p2.relatorioTecnico || '',
              status
            });

            controller.close();
          } catch (err) {
            console.error('Stream error:', err.message);
            send({ type: 'error', error: err.message });
            controller.close();
          }
        })();
      },
      cancel() {
        bodyCancelled = true;
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});