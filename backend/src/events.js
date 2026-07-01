// Log de eventos append-only (coordenação entre workers) + idempotência de webhook
// + heartbeat dos workers ("quem vigia os workers").
import { pool } from './db.js';

export async function logEvent(tenantId, source, type, payload = {}) {
  await pool.query(
    `INSERT INTO tenant_events (tenant_id, source, type, payload) VALUES ($1, $2, $3, $4)`,
    [tenantId, source, type, JSON.stringify(payload)]
  );
}

/**
 * Marca um webhook (Stripe ou Meta) como processado. Retorna `false` se esse
 * event_id já tinha sido processado antes (webhook reenviado) — quem chamou deve
 * responder 200 e não repetir nenhum efeito colateral (cobrar, provisionar, etc).
 */
export async function claimWebhookEvent(eventId, source) {
  try {
    await pool.query(
      `INSERT INTO processed_webhook_events (event_id, source) VALUES ($1, $2)`,
      [eventId, source]
    );
    return true;
  } catch (e) {
    if (e.code === '23505') return false; // violação de PK = já processado
    throw e;
  }
}

// Só chamar quando o ciclo do worker terminou COM sucesso — isso é o que
// staleWorkers() usa pra saber se o worker está vivo. Nunca atualiza last_ok_at
// numa falha, senão um worker que está sempre errando nunca apareceria como "travado".
export async function beatHeartbeat(workerName) {
  await pool.query(
    `INSERT INTO worker_heartbeats (worker_name, last_ok_at, last_error)
     VALUES ($1, now(), NULL)
     ON CONFLICT (worker_name) DO UPDATE SET last_ok_at = now(), last_error = NULL`,
    [workerName]
  );
}

// Registra o motivo do erro sem mexer em last_ok_at (preserva a detecção de staleness).
export async function recordWorkerError(workerName, errorMessage) {
  await pool.query(
    `INSERT INTO worker_heartbeats (worker_name, last_ok_at, last_error)
     VALUES ($1, now(), $2)
     ON CONFLICT (worker_name) DO UPDATE SET last_error = $2`,
    [workerName, errorMessage]
  );
}

// Workers travados: nenhum heartbeat bem-sucedido há mais que o intervalo esperado.
export async function staleWorkers(maxAgeMinutes = 5) {
  const { rows } = await pool.query(
    `SELECT worker_name, last_ok_at, last_error FROM worker_heartbeats
     WHERE last_ok_at < now() - ($1 || ' minutes')::interval`,
    [maxAgeMinutes]
  );
  return rows;
}
