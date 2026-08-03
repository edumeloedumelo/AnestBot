import { isValidCnsFormat, isValidCpf, levenshtein, nameSimilarity, normalizeName } from "./matching.util";

describe("normalizeName", () => {
  test("remove acentos, partículas e normaliza espaços", () => {
    expect(normalizeName("Maria Aparecida de Souza")).toBe("maria aparecida souza");
    expect(normalizeName("  JOÃO   D'Ávila dos Santos ")).toBe("joao d avila santos");
    expect(normalizeName("Ana-Clara é")).toBe("ana clara");
  });
});

describe("levenshtein", () => {
  test("distâncias básicas", () => {
    expect(levenshtein("souza", "souza")).toBe(0);
    expect(levenshtein("souza", "sousa")).toBe(1);
    expect(levenshtein("maria", "mario")).toBe(1);
    expect(levenshtein("ana", "beatriz")).toBeGreaterThan(3);
  });
});

describe("nameSimilarity", () => {
  test("nomes iguais após normalização pontuam 1", () => {
    expect(nameSimilarity("maria aparecida souza", "maria aparecida souza")).toBe(1);
  });

  test("variação ortográfica (souza/sousa) e partícula removida seguem altas", () => {
    const a = normalizeName("Maria Aparecida de Souza");
    const b = normalizeName("Maria Aparecida Sousa");
    expect(nameSimilarity(a, b)).toBeGreaterThanOrEqual(0.9);
  });

  test("abreviação por inicial casa (J. Carlos ~ Joao Carlos)", () => {
    expect(nameSimilarity(normalizeName("J Carlos Ferreira"), normalizeName("João Carlos Ferreira"))).toBe(1);
  });

  test("nomes diferentes pontuam baixo", () => {
    expect(nameSimilarity(normalizeName("Ana Beatriz Lima"), normalizeName("Carlos Eduardo Ramos"))).toBeLessThan(0.4);
  });

  test("sobrenome ausente reduz o score (não é match automático)", () => {
    expect(nameSimilarity(normalizeName("Maria Souza"), normalizeName("Maria Aparecida Souza Melo"))).toBeLessThan(0.7);
  });
});

describe("isValidCpf", () => {
  test("aceita CPF válido (gerado pelo algoritmo oficial) com ou sem máscara", () => {
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCpf("529.982.247-25")).toBe(true);
  });

  test("rejeita dígito verificador errado, sequências repetidas e tamanho errado", () => {
    expect(isValidCpf("52998224724")).toBe(false);
    expect(isValidCpf("11111111111")).toBe(false);
    expect(isValidCpf("1234567890")).toBe(false);
  });
});

describe("isValidCnsFormat", () => {
  test("exige 15 dígitos", () => {
    expect(isValidCnsFormat("123456789012345")).toBe(true);
    expect(isValidCnsFormat("12345678901234")).toBe(false);
  });
});
