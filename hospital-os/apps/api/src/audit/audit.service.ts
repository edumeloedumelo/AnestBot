import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PoolClient } from "pg";
import { DbService } from "../db/db.service";

export type AuditEventInput = {
  tenantId: string;
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  data?: Record<string, unknown> | null;
  justification?: string | null;
  sourceIp?: string | null;
};

const GENESIS_HASH = "genesis";

/** JSON canônico (chaves ordenadas) para hash determinístico. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)));
    }
    return v;
  });
}

/**
 * Normaliza o evento antes do hash: todo campo opcional vira null explícito,
 * para que o hash calculado no append seja idêntico ao recalculado a partir
 * das colunas do banco (onde ausência é NULL, nunca "campo omitido").
 */
function normalizeForHash(event: AuditEventInput & { occurredAt: string }) {
  return {
    tenantId: event.tenantId,
    actorId: event.actorId ?? null,
    actorRole: event.actorRole ?? null,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    data: event.data ?? null,
    justification: event.justification ?? null,
    sourceIp: event.sourceIp ?? null,
    occurredAt: event.occurredAt,
  };
}

function eventHash(prevHash: string, event: AuditEventInput & { occurredAt: string }): string {
  return createHash("sha256").update(`${prevHash}\n${canonical(normalizeForHash(event))}`).digest("hex");
}

/**
 * Trilha de auditoria imutável (ADR-006, DATA_MODEL.md §4).
 * - Append-only: UPDATE/DELETE/TRUNCATE são bloqueados por trigger no banco.
 * - Hash encadeado por tenant: cada evento assina o hash do anterior;
 *   verifyChain() detecta qualquer adulteração posterior.
 * - append() aceita um client de transação para que o evento de auditoria e a
 *   escrita de negócio sejam atômicos.
 */
@Injectable()
export class AuditService {
  constructor(private readonly db: DbService) {}

  async append(client: PoolClient, event: AuditEventInput): Promise<{ seq: number; hash: string }> {
    // Serializa a cadeia do tenant dentro da transação corrente.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [event.tenantId]);
    const prev = await client.query("SELECT hash FROM audit_event WHERE tenant_id = $1 ORDER BY seq DESC LIMIT 1", [
      event.tenantId,
    ]);
    const prevHash: string = prev.rows[0]?.hash ?? GENESIS_HASH;
    const occurredAt = new Date().toISOString();
    const hash = eventHash(prevHash, { ...event, occurredAt });

    const inserted = await client.query(
      `INSERT INTO audit_event
         (tenant_id, actor_id, actor_role, action, entity_type, entity_id, data, justification, source_ip, occurred_at, prev_hash, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING seq`,
      [
        event.tenantId,
        event.actorId ?? null,
        event.actorRole ?? null,
        event.action,
        event.entityType,
        event.entityId ?? null,
        event.data ?? null,
        event.justification ?? null,
        event.sourceIp ?? null,
        occurredAt,
        prevHash,
        hash,
      ]
    );
    return { seq: Number(inserted.rows[0].seq), hash };
  }

  /** Registra um evento em transação própria (fora de uma escrita de negócio). */
  async record(event: AuditEventInput): Promise<{ seq: number; hash: string }> {
    return this.db.withTenant(event.tenantId, (client) => this.append(client, event));
  }

  /** Recalcula a cadeia inteira do tenant e aponta o primeiro elo inválido. */
  async verifyChain(tenantId: string): Promise<{ valid: boolean; brokenAtSeq?: number }> {
    return this.db.withTenant(tenantId, async (client) => {
      const events = await client.query(
        `SELECT seq, tenant_id, actor_id, actor_role, action, entity_type, entity_id,
                data, justification, source_ip, occurred_at, prev_hash, hash
         FROM audit_event WHERE tenant_id = $1 ORDER BY seq ASC`,
        [tenantId]
      );
      let prevHash = GENESIS_HASH;
      for (const row of events.rows) {
        const expected = eventHash(prevHash, {
          tenantId: row.tenant_id,
          actorId: row.actor_id,
          actorRole: row.actor_role,
          action: row.action,
          entityType: row.entity_type,
          entityId: row.entity_id,
          data: row.data,
          justification: row.justification,
          sourceIp: row.source_ip,
          occurredAt: new Date(row.occurred_at).toISOString(),
        });
        if (row.prev_hash !== prevHash || row.hash !== expected) {
          return { valid: false, brokenAtSeq: Number(row.seq) };
        }
        prevHash = row.hash;
      }
      return { valid: true };
    });
  }
}
