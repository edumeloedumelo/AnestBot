// Worker de Execução: o retry imediato de uma triagem que falhou (ex: erro
// pontual da Anthropic, arquivo ilegível) acontece na hora, dentro do próprio
// bot (bot/src/triage.js) — não dá pra "reprocessar" depois por aqui, porque a
// mídia da paciente é efêmera (não guardamos nada). O papel deste worker é outro:
// olhar `tenant_events` (que o bot grava no mesmo banco) e alertar se um tenant
// está tendo falhas repetidas — sinal de problema sistêmico (ex: Anthropic fora
// do ar), não um caso isolado.
import { pool } from '../db.js';
import { logEvent } from '../events.js';

const FAILURE_THRESHOLD = 3;
const WINDOW_MINUTES = 30;

export async function reconcileExecutionFailures() {
  const { rows } = await pool.query(
    `SELECT tenant_id, COUNT(*) AS falhas
     FROM tenant_events
     WHERE source = 'execution' AND type = 'triage.failed'
       AND created_at > now() - ($1 || ' minutes')::interval
     GROUP BY tenant_id
     HAVING COUNT(*) >= $2`,
    [WINDOW_MINUTES, FAILURE_THRESHOLD]
  );

  for (const row of rows) {
    try {
      await logEvent(row.tenant_id, 'execution', 'failure_rate_alert', {
        falhas: Number(row.falhas),
        janelaMinutos: WINDOW_MINUTES,
      });
    } catch (e) {
      console.error(`[worker:execution] falha registrando alerta pro tenant ${row.tenant_id}:`, e.message);
    }
  }
}
