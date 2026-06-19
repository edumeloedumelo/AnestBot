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

  // Arquivos de texto (pequenos) — mantém abordagem original
  const buffer = await res.arrayBuffer();
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

    // Construir prompt médico completo
    const systemPrompt = `Você é um médico anestesista fazendo avaliação pré-operatória de triagem. Execute este prompt com exatidão.

## CIRURGIAS CADASTRADAS
${surgeries.map(s => `- **${s.name}** → key: "${s.key}" | Exames obrigatórios: ${(s.required_exams || []).join(', ')}`).join('\n')}

## LIMITES CLÍNICOS DE REFERÊNCIA
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
- Mama/BIRADS: 1-2 ok. 3-6 → encaminhar mastologista + parecer. Sem parecer = 🚨 pendência crítica.
- RX tórax: nódulo → pneumologista obrigatório.
- Anti-HBs < 2 não contraindica — apenas informe.
- GLP-1 (Ozempic, Mounjaro, Wegovy, Saxenda, Rybelsus, Trulicity): suspender 21 dias.
- Avaliar anticoagulantes, antiagregantes, AAS, clopidogrel, rivaroxabana, varfarina, anticoncepcionais, hipoglicemiantes, corticoides, imunossupressores, psicotrópicos.
- Ilegível/cortado/desfocado: "❓ Ilegível". NUNCA invente.
- Exame obrigatório não enviado → "❌ Não enviado".

## PROIBIÇÕES ABSOLUTAS
Nunca: inventar resultados · inventar exames · presumir BIRADS · presumir ECG normal · ignorar Hb < 12 · ignorar nódulo pulmonar · ignorar medicações relevantes · liberar cirurgia sem exames obrigatórios · ignorar exame ilegível · substituir avaliação médica presencial. Em dúvida → interpretação mais conservadora.

## FORMATO DO RELATÓRIO (relatorioTecnico)
\`\`\`
🧾 TRIAGEM PRÉ-OPERATÓRIA
👩‍⚕️ Cirurgia: [tipo]
ITEM                  STATUS
[listar cada exame obrigatório com ✅/⚠️/❌]
🚨 ALERTAS / ALTERAÇÕES
* [alteração]
📌 STATUS FINAL: [✅/⚠️/❌/🚨]
📋 CONDUTA: [até 3 linhas]
\`\`\`

## FORMATO BLOCO WHATSAPP (blocoResumo)
\`\`\`
📋 RESUMO — TRIAGEM PRÉ-ANESTÉSICA
Nome: [nome] | Cirurgia: [tipo]
Exames alterados / faltando: • [item] (ou: nenhum ✅)
Medicações a suspender: • [medicação] — [tempo] (ou: nenhuma ✅)
Alertas críticos: • [alerta] (ou: nenhum ✅)
📌 [✅ liberado / ⚠️ com ressalvas / ❌ pendente / 🚨 não liberar]
\`\`\`

## JSON DE SAÍDA — Gere phase1 PRIMEIRO, depois phase2:
{
  "phase1": {
    "patientName": "Nome completo",
    "patientInfo": "idade, peso, comorbidades, data cirurgia",
    "surgeryType": "Nome da cirurgia"
  },
  "phase2": {
    "examResults": [{"exam":"...", "status":"✅|⚠️|❌|❓", "value":"resultado resumido"}],
    "alerts": ["⚠️ Alerta com detalhe"],
    "missingExams": ["Exame faltante"],
    "alteredExams": ["Exame alterado (valor)"],
    "finalStatus": "✅ Completo sem alertas relevantes",
    "conduct": "Conduta em até 3 linhas",
    "blocoResumo": "📋 RESUMO... (use \\n para quebras)",
    "relatorioTecnico": "🧾 TRIAGEM... (use \\n para quebras)"
  }
}

IMPORTANTE: Gere phase1 PRIMEIRO (identificação) e só depois phase2 (análise dos exames). Retorne JSON puro, sem markdown.`;

    // Baixar arquivos
    console.log(`Baixando ${fileUrls.length} arquivos...`);
    const blocks = await Promise.all(fileUrls.map((url, i) => fetchFileBlock(url, i)));

    const content = [];
    content.push({ type: 'text', text: `Analise TODOS os ${fileUrls.length} exames como médico anestesista.${anamnesis.trim() ? '\n\nANAMNESE / OBSERVAÇÕES:\n' + anamnesis : ''}\n\nSiga EXATAMENTE o protocolo. Identifique paciente e cirurgia (phase1), depois analise cada exame (phase2). Retorne SOMENTE o JSON.` });
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

            // Parse final com reparo automático de erros comuns da IA
            const repairAndParse = (raw) => {
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
              // Corrige vírgulas faltando entre elementos de array: "a" "b" → "a", "b"
              s = s.replace(/"\s+(?=")/g, (m) => m.includes(',') ? m : '", "');
              return JSON.parse(s);
            };

            try {
              finalResult = repairAndParse(fullText);
            } catch {
              const match = fullText.match(/\{[\s\S]*\}/);
              if (match) finalResult = repairAndParse(match[0]);
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
              missing_exams: p2.missingExams || [],
              altered_exams: p2.alteredExams || [],
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
              missingExams: p2.missingExams || [],
              alteredExams: p2.alteredExams || [],
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