// Formata a saída do Claude para o WhatsApp.
// O modelo já gera um card único com negrito (*..*), emojis e marcadores.
// Aqui só limpamos resíduos de markdown e garantimos o formato.
export function formatTriageReply(fullText) {
  let text = (fullText || '').trim();

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
