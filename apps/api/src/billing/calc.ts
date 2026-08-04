// Calculadora de honorário anestésico — PURA e determinística.
//
// Regras (seção 15 do prompt-mestre):
//   • dinheiro SEMPRE em centavos inteiros (bigint no banco, number inteiro aqui —
//     dentro do intervalo seguro: teto de 2^53-1 centavos ≈ R$ 90 trilhões);
//   • procedimentos múltiplos: 100% no maior porte, 70% no segundo, 50% nos demais
//     (percentuais configuráveis por chamada — cada convênio tem os seus);
//   • acréscimos percentuais (urgência, horário noturno/fim de semana) aplicados
//     sobre o subtotal;
//   • arredondamento HALF-UP por item, documentado na memória de cálculo;
//   • a memória registra cada passo com entradas e saídas — o mesmo input
//     reproduz EXATAMENTE o mesmo output.
//
// Valores de porte vêm SEMPRE do banco (tabela do convênio) — nunca do cliente.

export interface CalcProcedure {
  code: string;
  description: string;
  port: string;
  base_cents: number; // valor do porte no convênio (centavos)
}

export interface CalcInput {
  procedures: CalcProcedure[];               // ordem livre — a calculadora ordena por base desc
  multiple_pcts?: number[];                  // padrão [100, 70, 50, 50, ...]
  urgency_pct?: number;                      // ex.: 30 (=+30%)
  night_weekend_pct?: number;                // ex.: 20 (=+20%)
}

export interface CalcItem {
  position: number;
  code: string;
  description: string;
  port: string;
  base_cents: number;
  applied_pct: number;
  amount_cents: number;
}

export interface CalcResult {
  items: CalcItem[];
  subtotal_cents: number;
  surcharges: { label: string; pct: number; amount_cents: number }[];
  total_cents: number;
  memory: string[]; // memória de cálculo legível e reproduzível
}

// Arredondamento half-up sobre um racional (num/den) — sem floats.
export function roundHalfUpCents(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new Error('cálculo monetário exige inteiros seguros');
  }
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

const fmt = (cents: number): string => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;

export function calculate(input: CalcInput): CalcResult {
  if (!input.procedures.length) throw new Error('ao menos um procedimento é necessário');
  for (const p of input.procedures) {
    if (!Number.isSafeInteger(p.base_cents) || p.base_cents < 0) throw new Error(`valor inválido para ${p.code}`);
  }
  const pcts = input.multiple_pcts?.length ? input.multiple_pcts : [100, 70, 50];
  for (const pct of pcts) {
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new Error('percentual de múltiplos inválido');
  }
  const memory: string[] = [];
  memory.push(`Regra de múltiplos: ${pcts.join('/')}% (excedentes usam ${pcts[pcts.length - 1]}%)`);

  // Ordena por base DESC (desempate por código — determinismo total).
  const sorted = [...input.procedures].sort((a, b) => (b.base_cents - a.base_cents) || a.code.localeCompare(b.code));

  const items: CalcItem[] = sorted.map((p, i) => {
    const applied = pcts[Math.min(i, pcts.length - 1)] ?? 100;
    const amount = roundHalfUpCents(p.base_cents * applied, 100);
    memory.push(`${i + 1}º) ${p.code} porte ${p.port}: ${fmt(p.base_cents)} × ${applied}% = ${fmt(amount)} (half-up)`);
    return {
      position: i + 1, code: p.code, description: p.description, port: p.port,
      base_cents: p.base_cents, applied_pct: applied, amount_cents: amount,
    };
  });

  const subtotal = items.reduce((s, it) => s + it.amount_cents, 0);
  memory.push(`Subtotal: ${fmt(subtotal)}`);

  const surcharges: CalcResult['surcharges'] = [];
  let total = subtotal;
  const addSurcharge = (label: string, pct: number | undefined): void => {
    if (!pct) return;
    if (!Number.isInteger(pct) || pct < 0 || pct > 300) throw new Error(`acréscimo inválido: ${label}`);
    const amount = roundHalfUpCents(subtotal * pct, 100);
    surcharges.push({ label, pct, amount_cents: amount });
    total += amount;
    memory.push(`Acréscimo ${label}: ${pct}% sobre ${fmt(subtotal)} = ${fmt(amount)} (half-up)`);
  };
  addSurcharge('urgência', input.urgency_pct);
  addSurcharge('horário noturno/fim de semana', input.night_weekend_pct);

  memory.push(`TOTAL: ${fmt(total)}`);
  return { items, subtotal_cents: subtotal, surcharges, total_cents: total, memory };
}
