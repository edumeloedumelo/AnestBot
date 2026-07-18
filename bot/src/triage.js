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
  if (surgeryType) {
    contextText += `Cirurgia: ${surgeryType}\n`;
  } else {
    contextText += `Cirurgia: (LEIA o campo "Procedimento:" ou "Cirurgia:" na anamnese abaixo e copie o valor exato. Se esse campo existir e for legível, use-o — isso é leitura, não inferência. Se genuinamente não houver nenhum campo de procedimento na anamnese, escreva "Não informada" e solicite o procedimento na seção CONDUTA.)\n`;
  }
  if (anamnesis && anamnesis.trim()) {
    contextText += `\n### Anamnese / Textos do grupo\n${anamnesis}\n`;
  }
  contextText += `\nAnalise todos os exames enviados abaixo. Siga rigorosamente o protocolo de triagem pré-anestésica.`;

  const contentBlocks = [{ type: 'text', text: contextText }];

  const errors = [];
  console.error(`[triage] ${(media || []).length} mídia(s) para processar`);
  for (const m of media || []) {
    console.error(`[triage] baixando: url=${m.url ? m.url.substring(0, 80) : 'AUSENTE'} type=${m.type}`);
    if (!m.url) { errors.push('URL de mídia ausente'); continue; }
    try {
      const block = await downloadMediaBlock(m.url, m.type === 'link');
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
    fullText = await retryWithoutBadBlocks(system, contentBlocks, e, errors);
  }
  return { fullText, mediaCount: (media || []).length, errors };
}

// Tenta reprocessar removendo apenas o(s) bloco(s) que causaram a rejeição da API.
// Estratégia: extrai índice do erro quando possível; senão remove do final um a um.
async function retryWithoutBadBlocks(system, contentBlocks, originalError, errors) {
  const isMediaError = /content\.\d+|pdf|image|base64|invalid_request/i.test(originalError.message);
  if (!isMediaError || contentBlocks.length <= 1) throw originalError;

  console.error('[triage] análise com mídia falhou, tentando remover blocos ruins:', originalError.message);

  // Tenta identificar o bloco exato pelo índice mencionado no erro (ex: "content.2")
  const idxMatch = originalError.message.match(/content\.(\d+)/);
  if (idxMatch) {
    const badIdx = parseInt(idxMatch[1]);
    const reduced = contentBlocks.filter((_, i) => i !== badIdx);
    try {
      const text = await analyze(system, reduced);
      errors.push('1 arquivo foi rejeitado pela IA e ignorado.');
      return text;
    } catch (e2) {
      // continua para fallback progressivo
    }
  }

  // Fallback progressivo: remove blocos do final até funcionar
  let reduced = contentBlocks.slice(0, -1);
  while (reduced.length > 1) {
    try {
      const text = await analyze(system, reduced);
      const dropped = contentBlocks.length - reduced.length;
      errors.push(`${dropped} arquivo(s) foram rejeitados pela IA e ignorados.`);
      return text;
    } catch (e2) {
      if (/content\.\d+|pdf|image|base64|invalid_request/i.test(e2.message) && reduced.length > 1) {
        reduced = reduced.slice(0, -1);
      } else {
        throw e2;
      }
    }
  }

  // Último recurso: só texto
  errors.push('Todos os arquivos de mídia foram ignorados (IA rejeitou). Análise feita apenas com o texto da anamnese.');
  return analyze(system, [contentBlocks[0]]);
}
