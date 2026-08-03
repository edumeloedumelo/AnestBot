import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { PoolClient } from "pg";
import { DbService } from "../db/db.service";

export type DomainEvent = { tenantId: string; topic: string; payload: Record<string, unknown> };

/**
 * Entrega de eventos a clientes conectados. O gateway WebSocket implementa
 * esta interface; testes usam um broadcaster de gravação.
 */
export interface EventBroadcaster {
  broadcast(tenantId: string, topic: string, payload: Record<string, unknown>): void;
}

@Injectable()
export class EventsService {
  /**
   * Escreve o evento no outbox DENTRO da transação de negócio corrente.
   * Payload mínimo por regra: identificadores e status, nunca dado clínico
   * (ver 0010_domain_events.sql).
   */
  async emit(client: PoolClient, event: DomainEvent): Promise<void> {
    await client.query("INSERT INTO domain_event (tenant_id, topic, payload) VALUES ($1, $2, $3)", [
      event.tenantId,
      event.topic,
      event.payload,
    ]);
  }
}

const POLL_INTERVAL_MS = 500;
const BATCH_SIZE = 100;

/**
 * Publisher do outbox: entrega eventos commitados ao broadcaster e marca
 * published_at. poll() é público e determinístico para os testes; o timer é
 * ligado apenas quando um broadcaster se registra (o gateway, no bootstrap).
 */
@Injectable()
export class EventsPublisher implements OnModuleDestroy {
  private readonly logger = new Logger(EventsPublisher.name);
  private broadcaster: EventBroadcaster | null = null;
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(private readonly db: DbService) {}

  register(broadcaster: EventBroadcaster): void {
    this.broadcaster = broadcaster;
    if (!this.timer) {
      this.timer = setInterval(() => {
        void this.poll().catch((err) => this.logger.error(`outbox poll failed: ${(err as Error).message}`));
      }, POLL_INTERVAL_MS);
      this.timer.unref();
    }
  }

  /** Publica um lote de eventos pendentes. Retorna quantos publicou. */
  async poll(): Promise<number> {
    if (!this.broadcaster || this.polling) return 0;
    this.polling = true;
    try {
      const client = await this.db.pool.connect();
      try {
        // FOR UPDATE SKIP LOCKED: múltiplas instâncias não publicam em dobro.
        await client.query("BEGIN");
        const pending = await client.query(
          `SELECT id, tenant_id, topic, payload FROM domain_event
           WHERE published_at IS NULL ORDER BY id ASC LIMIT $1 FOR UPDATE SKIP LOCKED`,
          [BATCH_SIZE]
        );
        for (const row of pending.rows) {
          this.broadcaster.broadcast(row.tenant_id, row.topic, row.payload);
        }
        if (pending.rowCount) {
          await client.query("UPDATE domain_event SET published_at = now() WHERE id = ANY($1)", [
            pending.rows.map((r) => r.id),
          ]);
        }
        await client.query("COMMIT");
        return pending.rowCount ?? 0;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } finally {
      this.polling = false;
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
