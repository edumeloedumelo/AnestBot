// Formata a saída do CEO para WhatsApp.
export function formatLegalReply(fullText) {
  let text = (fullText || '').trim();

  // Remove cercas de código
  text = text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '');
  // **negrito** markdown → *negrito* WhatsApp
  text = text.replace(/\*\*(.+?)\*\*/g, '*$1*');
  // Remove marcadores # de título markdown
  text = text.replace(/^#{1,6}\s*/gm, '');
  // Compacta 3+ quebras em no máximo 2
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return [text];
}
