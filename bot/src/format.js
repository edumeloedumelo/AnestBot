// Formata a saída do Claude para o WhatsApp.
// O modelo já gera um card único com negrito (*..*), emojis e marcadores.
// Aqui só limpamos resíduos de markdown e garantimos o formato.
export function formatTriageReply(fullText) {
  let text = (fullText || '').trim();

  // Defesa: se o modelo gerar algum preâmbulo em prosa antes do card (ex.: "Vou
  // analisar os documentos...", "Documentos identificados:"), descarta tudo antes
  // do marcador do card — o usuário só deve ver o card. Loga o preâmbulo removido
  // para não perder informação silenciosamente (a instrução no prompt já proíbe
  // isso, mas esta é uma segunda camada de proteção).
  //
  // ÂNCORA IMPORTANTE: exigimos o marcador SEGUIDO da linha separadora
  // (━━━...) do template, não só o texto "🧾 *AVALIAÇÃO PRÉ-ANESTÉSICA*"
  // isolado. Isso evita cortar no lugar errado se o modelo mencionar esse
  // texto em prosa antes do card real (ex.: "vou começar com 🧾 *AVALIAÇÃO
  // PRÉ-ANESTÉSICA* como primeira linha...") — uma menção solta em prosa
  // nunca é seguida pela linha separadora, só o card de verdade é. Também
  // usamos a ÚLTIMA ocorrência da âncora (não a primeira), como proteção
  // extra contra qualquer repetição patológica.
  const cardStart = /🧾\s*\*AVALIAÇÃO PRÉ-ANESTÉSICA\*\s*\n━{3,}/g;
  const matches = [...text.matchAll(cardStart)];
  if (matches.length > 0) {
    const last = matches[matches.length - 1];
    if (last.index > 0) {
      const preamble = text.slice(0, last.index).trim();
      if (preamble) {
        console.error('[formatTriageReply] preâmbulo detectado e removido antes do card:', preamble.slice(0, 500));
      }
      text = text.slice(last.index);
    }
  }

  // Remove cercas de código que o modelo possa ter incluído por engano.
  text = text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '');
  // Converte eventual **negrito** markdown para *negrito* do WhatsApp.
  text = text.replace(/\*\*(.+?)\*\*/g, '*$1*');
  // Remove marcadores de título markdown (#) no início de linhas.
  text = text.replace(/^#{1,6}\s*/gm, '');
  // Remove separador legado, caso o modelo ainda gere.
  text = text.replace(/^-+PARTE2-+$/gm, '');
  // Compacta 3+ quebras de linha em no máximo 2.
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return [text];
}
