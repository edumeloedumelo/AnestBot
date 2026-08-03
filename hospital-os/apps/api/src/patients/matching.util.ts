/**
 * Utilitários de identificação segura do paciente (F1-E5):
 * - normalização de nomes para busca e comparação (pt-BR);
 * - similaridade de nomes tolerante a partículas, abreviações e digitação;
 * - validação de CPF (dígitos verificadores) e formato de CNS.
 */

const NAME_PARTICLES = new Set(["de", "da", "do", "das", "dos", "e"]);

export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0 && !NAME_PARTICLES.has(token))
    .join(" ");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const insertOrDelete = Math.min(prev[j], prev[j - 1]) + 1;
      const substitute = diagonal + (a[i - 1] === b[j - 1] ? 0 : 1);
      diagonal = prev[j];
      prev[j] = Math.min(insertOrDelete, substitute);
    }
  }
  return prev[b.length];
}

/**
 * Similaridade entre nomes normalizados, em [0, 1].
 * Tokens casam por igualdade, distância de edição ≤ 1 (erro de digitação) ou
 * abreviação por inicial ("j." ~ "joao"). Score = tokens casados / total do
 * maior nome — sobrenomes ausentes penalizam, ordem não importa.
 */
export function nameSimilarity(aNormalized: string, bNormalized: string): number {
  const aTokens = aNormalized.split(" ").filter(Boolean);
  const bTokens = bNormalized.split(" ").filter(Boolean);
  if (aTokens.length === 0 || bTokens.length === 0) return 0;

  const remaining = [...bTokens];
  let matched = 0;
  for (const token of aTokens) {
    const index = remaining.findIndex(
      (candidate) =>
        candidate === token ||
        (token.length > 3 && candidate.length > 3 && levenshtein(token, candidate) <= 1) ||
        (token.length === 1 && candidate.startsWith(token)) ||
        (candidate.length === 1 && token.startsWith(candidate))
    );
    if (index >= 0) {
      matched += 1;
      remaining.splice(index, 1);
    }
  }
  return matched / Math.max(aTokens.length, bTokens.length);
}

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Validação completa de CPF: formato + dígitos verificadores. */
export function isValidCpf(cpf: string): boolean {
  const digits = onlyDigits(cpf);
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  for (const position of [9, 10] as const) {
    let sum = 0;
    for (let i = 0; i < position; i++) {
      sum += Number(digits[i]) * (position + 1 - i);
    }
    const expected = ((sum * 10) % 11) % 10;
    if (expected !== Number(digits[position])) return false;
  }
  return true;
}

/** CNS: 15 dígitos (validação de algoritmo completo fica para a integração CNES). */
export function isValidCnsFormat(cns: string): boolean {
  return /^\d{15}$/.test(onlyDigits(cns));
}
