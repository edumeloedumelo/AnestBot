// Formata a saída do Claude para mensagens de WhatsApp (monoespaçado/alinhado).
export function formatTriageReply(fullText) {
  const parts = fullText.split('---PARTE2---');
  const relatorio = stripFences(parts[0] || '').trim();
  const resumo = stripFences(parts[1] || '').trim();

  const messages = [];
  // Relatório técnico em bloco monoespaçado (mantém alinhamento das colunas).
  if (relatorio) messages.push('```\n' + relatorio + '\n```');
  // Resumo: texto corrido normal (fácil de copiar pro prontuário).
  if (resumo) messages.push(resumo);
  if (messages.length === 0) messages.push(fullText.trim());
  return messages;
}

// Remove cercas de código markdown que o modelo possa ter incluído.
function stripFences(text) {
  return text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '');
}
