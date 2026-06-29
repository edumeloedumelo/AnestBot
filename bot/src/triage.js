// Orquestra a análise de uma triagem: junta contexto + mídias, chama Claude, formata.
import { getConfig } from './config.js';
import { buildSystemPrompt } from './prompt.js';
import { analyze } from './anthropic.js';
import { downloadMediaBlock } from './ultramsg.js';

export async function runTriage({ patientName, surgeryType, anamnesis, media }) {
  const config = getConfig();
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
    console.error(`[triage] baixando: url=${m.url ? m.url.substring(0,80) : 'AUSENTE'} type=${m.type}`);
    if (!m.url) { errors.push('URL de mídia ausente'); continue; }
    try {
      const block = await downloadMediaBlock(m.url);
      console.error(`[triage] bloco adicionado: type=${block.type}`);
      contentBlocks.push(block);
    } catch (e) {
      errors.push(e.message);
      console.error('[triage] mídia falhou:', m.url, e.message);
    }
  }

  let fullText;
  try {
    fullText = await analyze(system, contentBlocks);
  } catch (e) {
    // Se a API rejeitar por causa de algum arquivo problemático, refaz só com texto
    // para garantir que o médico sempre receba um relatório.
    const isMediaError = /content\.\d+|pdf|image|base64|invalid_request/i.test(e.message);
    if (isMediaError && contentBlocks.length > 1) {
      console.error('[triage] análise com mídia falhou, refazendo só com texto:', e.message);
      errors.push('Um ou mais exames não puderam ser processados pela IA e foram ignorados.');
      fullText = await analyze(system, [contentBlocks[0]]);
    } else {
      throw e;
    }
  }
  return { fullText, mediaCount: (media || []).length, errors };
}
