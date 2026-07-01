// Mesma tabela processed_webhook_events do backend/ (banco compartilhado) —
// evita reprocessar uma mensagem se a Meta reentregar o webhook.
import { pool } from './db.js';

export async function claimWebhookEvent(eventId, source) {
  try {
    await pool.query(
      `INSERT INTO processed_webhook_events (event_id, source) VALUES ($1, $2)`,
      [eventId, source]
    );
    return true;
  } catch (e) {
    if (e.code === '23505') return false; // já processado
    throw e;
  }
}
