export function formatFisioReply(fullText) {
  let text = (fullText || '').trim();
  text = text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '');
  text = text.replace(/\*\*(.+?)\*\*/g, '*$1*');
  text = text.replace(/^#{1,6}\s*/gm, '');
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return [text];
}
