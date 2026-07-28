// Monta o pedido ao Claude (contexto de texto + blocos de mídia) e devolve o laudo.
import { getConfig } from './config.js';
import { buildSystemPrompt } from './prompt.js';
import { analyze } from './anthropic.js';
import { downloadMediaBlock } from './media.js';

export async function runTriage({ patientName, surgeryType, anamnesis, media }) {
  const system = buildSystemPrompt(getConfig());

  let ctx = `## DADOS DA PACIENTE\n`;
  ctx += `Nome: ${patientName || '(não informado)'}\n`;
  if (surgeryType) {
    ctx += `Cirurgia: ${surgeryType}\n`;
  } else {
    ctx += `Cirurgia: (LEIA o campo "Procedimento:"/"Cirurgia:" na anamnese abaixo e copie o valor exato — ler não é inferência. Só escreva "Não informada" se realmente não houver menção a procedimento em lugar nenhum.)\n`;
  }
  if (anamnesis && anamnesis.trim()) ctx += `\n### Anamnese / Textos do grupo\n${anamnesis}\n`;
  ctx += `\nAnalise todos os exames enviados abaixo. Siga rigorosamente o protocolo de triagem pré-anestésica.`;

  const blocks = [{ type: 'text', text: ctx }];
  const errors = [];
  for (const md of media || []) {
    const label = md.caption || md.url || 'arquivo';
    if (!md.url) { errors.push(`${label}: sem URL`); continue; }
    try {
      blocks.push(await downloadMediaBlock(md.url));
    } catch (e) {
      errors.push(`${label}: ${e.message}`);
      console.error('[triage] mídia falhou:', md.url, e.message);
    }
  }

  let fullText;
  try {
    fullText = await analyze(system, blocks);
  } catch (e) {
    fullText = await retryDroppingMedia(system, blocks, e, errors);
  }
  return { fullText, errors };
}

// Se a API rejeitar por causa de um bloco de MÍDIA, remove só os blocos de mídia
// (índice > 0) — NUNCA o bloco 0, que é o texto da anamnese.
async function retryDroppingMedia(system, blocks, originalError, errors) {
  const isMediaErr = /content\.\d+.*(image|document|pdf|base64)|(image|document|pdf|base64).*content\.\d+/is.test(originalError.message);
  if (!isMediaErr || blocks.length <= 1) throw originalError;

  const idxMatch = originalError.message.match(/content\.(\d+)/);
  if (idxMatch) {
    const bad = parseInt(idxMatch[1]);
    if (bad === 0) throw originalError; // nunca remove o texto
    try {
      const t = await analyze(system, blocks.filter((_, i) => i !== bad));
      errors.push('1 arquivo rejeitado pela IA e ignorado.');
      return t;
    } catch { /* segue */ }
  }
  let reduced = blocks.slice(0, -1);
  while (reduced.length > 1) {
    try {
      const t = await analyze(system, reduced);
      errors.push(`${blocks.length - reduced.length} arquivo(s) rejeitado(s) e ignorado(s).`);
      return t;
    } catch (e2) {
      if (/content\.\d+|pdf|image|base64|invalid_request/i.test(e2.message)) reduced = reduced.slice(0, -1);
      else throw e2;
    }
  }
  errors.push('Todos os arquivos foram ignorados pela IA. Análise feita só com o texto.');
  return analyze(system, [blocks[0]]);
}
