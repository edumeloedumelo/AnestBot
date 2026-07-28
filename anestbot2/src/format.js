// Limpa a saída do Claude para o WhatsApp e remove qualquer preâmbulo antes do card.
export function formatReply(fullText) {
  let text = (fullText || '').trim();

  // Remove preâmbulo antes do card. Âncora: marcador SEGUIDO da linha separadora
  // (━━━) — assim uma menção solta ao marcador em prosa não corta no lugar errado.
  // Usa a ÚLTIMA ocorrência.
  const cardStart = /🧾\s*\*AVALIAÇÃO PRÉ-ANESTÉSICA\*\s*\n━{3,}/g;
  const matches = [...text.matchAll(cardStart)];
  if (matches.length) {
    const last = matches[matches.length - 1];
    if (last.index > 0) {
      const pre = text.slice(0, last.index).trim();
      if (pre) console.error('[format] preâmbulo removido:', pre.slice(0, 200));
      text = text.slice(last.index);
    }
  }

  text = text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '');
  text = text.replace(/\*\*(.+?)\*\*/g, '*$1*');
  text = text.replace(/^#{1,6}\s*/gm, '');
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}
