// Período mensal ('YYYY-MM') no fuso de São Paulo, pra bater com o "mês" comercial
// da clínica (não UTC). Usado tanto no backend (painel/cota) quanto no bot.
export function currentPeriod(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).format(date);
}
