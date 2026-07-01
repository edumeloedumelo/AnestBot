// Worker de Provisionamento: enquanto a criação de instância na UltraMsg for
// manual (ver aviso em routes/provisioning.js), este worker não tem como
// "reprocessar" sozinho — o papel dele é detectar quem ficou preso além do
// esperado e deixar isso visível/alertado pro dono (routes/admin.js já lê
// `tenant_events` do tipo stuck_detected em "provisionamento travado").
import { pool } from '../db.js';
import { logEvent } from '../events.js';

const STUCK_AFTER_MINUTES = 15;

export async function reconcileProvisioning() {
  const { rows: stuck } = await pool.query(
    `SELECT t.id, t.status, t.updated_at, w.provider_instance_id, w.status AS number_status
     FROM tenants t
     LEFT JOIN whatsapp_numbers w ON w.tenant_id = t.id
     WHERE t.status IN ('provisioning', 'awaiting_pairing')
       AND t.updated_at < now() - ($1 || ' minutes')::interval`,
    [STUCK_AFTER_MINUTES]
  );

  for (const tenant of stuck) {
    try {
      await logEvent(tenant.id, 'provisioning', 'stuck_detected', {
        minutosParado: STUCK_AFTER_MINUTES,
        temInstanciaAssociada: Boolean(tenant.provider_instance_id),
        status: tenant.status,
      });
    } catch (e) {
      console.error(`[worker:provisioning] falha no tenant ${tenant.id}:`, e.message);
    }
  }
}
