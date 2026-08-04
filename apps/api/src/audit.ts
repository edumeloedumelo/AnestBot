// Trilha de auditoria append-only. META NUNCA contém conteúdo clínico —
// apenas ids, ações e campos técnicos (o trigger do banco impede UPDATE/DELETE).
import crypto from 'node:crypto';
import type { Queryable } from './db.js';

export async function appendAudit(
  q: Queryable,
  entry: {
    teamId?: string | null;
    userId?: string | null;
    action: string;
    entityType?: string;
    entityId?: string;
    meta?: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  await q.query(
    `INSERT INTO audit_logs (id, team_id, user_id, action, entity_type, entity_id, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      crypto.randomUUID(),
      entry.teamId ?? null,
      entry.userId ?? null,
      entry.action,
      entry.entityType ?? '',
      entry.entityId ??  '',
      JSON.stringify(entry.meta ?? {}),
    ],
  );
}
