// Orquestra a análise de uma triagem: junta contexto + mídias, chama Claude, formata.
import { buildSystemPrompt } from './prompt.js';
import { analyze } from './anthropic.js';
import { downloadMediaBlock } from './ultramsg.js';

// Erros transientes (instabilidade momentânea da Anthropic) merecem nova tentativa
// automática — a médica nunca deveria ver "análise não concluída" por causa de um
// 429/5xx passageiro. Erros de conteúdo (mídia inválida) NÃO entram aqui — esses já
// têm o próprio fallback (refazer só com texto) mais abaixo.
async function analyzeWithRetry(system, blocks, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await analyze(system, blocks);
    } catch (e) {
      lastErr = e;
      const transient = /Claude API (5\d\d|429)/.test(e.message) || /network|fetch failed|ECONNRESET|ETIMEDOUT/i.test(e.message);
      if (!transient || i === attempts - 1) throw e;
      const delay = 500 * 2 ** i;
      console.error(`[triage] erro transiente (tentativa ${i + 1}/${attempts}), retry em ${delay}ms:`, e.message);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export async function runTriage({ config, patientName, surgeryType, anamnesis, media }) {
  const system = buildSystemPrompt(config);

  let contextText = `## DADOS DA PACIENTE\n`;
  contextText += `Nome: ${patientName || '(não informado)'}\n`;
  contextText += `Cirurgia: ${surgeryType || '(não identificada — infira do contexto se possível)'}\n`;
  if (anamnesis && anamnesis.trim()) {
    contextText += `\n### Anamnese / Textos do grupo\n${anamnesis}\n`;
  }
  contextText += `\nAnalise todos os exames enviados abaixo. Siga rigorosamente o protocolo de triagem pré-anestésica.`;

  const contentBlocks = [{ type: 'text', text: contextText }];

  const errors = [];
  console.error(`[triage] ${(media || []).length} mídia(s) para processar`);
  for (const m of media || []) {
    console.error(`[triage] baixando: url=${m.media ? m.media.substring(0, 80) : 'AUSENTE'} type=${m.type}`);
    if (!m.media) { errors.push('URL de mídia ausente'); continue; }
    try {
      const block = await downloadMediaBlock(m.media);
      console.error(`[triage] bloco adicionado: type=${block.type}`);
      contentBlocks.push(block);
    } catch (e) {
      errors.push(e.message);
      console.error('[triage] mídia falhou:', m.media, e.message);
    }
  }

  let fullText;
  try {
    fullText = await analyzeWithRetry(system, contentBlocks);
  } catch (e) {
    // Se a API rejeitar por causa de algum arquivo problemático, refaz só com texto
    // para garantir que o médico sempre receba um relatório.
    const isMediaError = /content\.\d+|pdf|image|base64|invalid_request/i.test(e.message);
    if (isMediaError && contentBlocks.length > 1) {
      console.error('[triage] análise com mídia falhou, refazendo só com texto:', e.message);
      errors.push('Um ou mais exames não puderam ser processados pela IA e foram ignorados.');
      fullText = await analyzeWithRetry(system, [contentBlocks[0]]);
    } else {
      throw e;
    }
  }
  return { fullText, mediaCount: (media || []).length, errors };
}
