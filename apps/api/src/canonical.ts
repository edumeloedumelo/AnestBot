// Serialização CANÔNICA e hash do registro anestésico.
//
// O registro estruturado é a fonte de verdade; o PDF é representação. A
// assinatura congela o snapshot canônico (chaves ordenadas, arrays em ordem
// estável) e grava seu sha256 — verificável a qualquer momento.
import crypto from 'node:crypto';

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

// JSON canônico: chaves de objeto ordenadas lexicograficamente, sem espaços.
// Determinístico entre execuções/máquinas (base da verificação do hash).
export function canonicalStringify(value: Json): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalStringify(v)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify((value as Record<string, Json>)[k] as Json)}`).join(',')}}`;
}

export interface RecordSnapshot {
  record_id: string;
  team_id: string;
  case_id: string | null;
  patient_id: string | null;
  pre: Json;
  intra: Json;
  post: Json;
  events: { at: string; kind: string; description: string; dose: string }[];
  vitals: { at: string; hr: number | null; sbp: number | null; dbp: number | null; spo2: number | null; temp_c: string | null; extra: Json }[];
}

export function snapshotHash(snapshot: RecordSnapshot): { canonical: string; hash: string } {
  const canonical = canonicalStringify(snapshot as unknown as Json);
  const hash = crypto.createHash('sha256').update(canonical).digest('hex');
  return { canonical, hash };
}
