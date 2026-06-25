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
  for (const m of media || []) {
    try {
      contentBlocks.push(await downloadMediaBlock(m.url));
    } catch (e) {
      errors.push(e.message);
      console.error('[triage] mídia falhou:', m.url, e.message);
    }
  }

  const fullText = await analyze(system, contentBlocks);
  return { fullText, mediaCount: (media || []).length, errors };
}
