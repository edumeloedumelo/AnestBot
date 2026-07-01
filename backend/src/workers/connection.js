// Worker de Conexão: audita o status de cada instância UltraMsg conectada (não
// depende de webhook pra isso, funciona mesmo se um webhook se perder). Se caiu
// por algo que só a própria cliente resolve (desconectou o WhatsApp do celular),
// registra o evento — push real pro provedor de notificação é um passo futuro
// (fora do escopo desta Fase 1; o evento já fica visível no painel do dono).
//
// Nível de confiança: o endpoint `/instance/status` é o padrão mais comum
// documentado da UltraMsg, mas o formato exato da resposta (`accountStatus` vs
// outra chave) não foi confirmado contra uma conta real nesta sessão — o parsing
// abaixo é best-effort e loga o payload bruto quando o status não é reconhecido,
// pra dar pra ajustar depois com um exemplo real.
import { pool } from '../db.js';
import { decryptToken } from '../crypto.js';
import { logEvent } from '../events.js';
import { transitionStatus } from '../tenants.js';

export async function reconcileConnections() {
  const { rows: numbers } = await pool.query(
    `SELECT w.*, t.status AS tenant_status, t.status_version AS tenant_status_version
     FROM whatsapp_numbers w
     JOIN tenants t ON t.id = w.tenant_id
     WHERE w.status IN ('connected', 'pending')`
  );

  for (const num of numbers) {
    try {
      const token = decryptToken(num.provider_token_encrypted);
      const res = await fetch(`https://api.ultramsg.com/${num.provider_instance_id}/instance/status?token=${encodeURIComponent(token)}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        await markDisconnected(num, `http_error: ${JSON.stringify(data).slice(0, 300)}`);
        continue;
      }

      const statusText = JSON.stringify(data).toLowerCase();
      const looksConnected = /authenticated|connected|"status":"open"/i.test(statusText);
      const looksDisconnected = /disconnected|logged.?out|unpaired|qr/i.test(statusText);

      if (looksConnected && num.status !== 'connected') {
        await pool.query(`UPDATE whatsapp_numbers SET status = 'connected', last_checked_at = now() WHERE tenant_id = $1`, [num.tenant_id]);
        await logEvent(num.tenant_id, 'connection', 'connected', {});
        if (num.tenant_status === 'awaiting_pairing') {
          await transitionStatus(num.tenant_id, { source: 'connection', to: 'active', expectedVersion: num.tenant_status_version });
        }
      } else if (looksDisconnected) {
        await markDisconnected(num, `status_payload: ${statusText.slice(0, 300)}`);
      } else {
        // Formato não reconhecido — só registra o checked_at, não muda status
        // sozinho (evita marcar desconectado por engano num parsing incerto).
        await pool.query(`UPDATE whatsapp_numbers SET last_checked_at = now() WHERE tenant_id = $1`, [num.tenant_id]);
        console.warn(`[worker:connection] status não reconhecido pro tenant ${num.tenant_id}:`, statusText.slice(0, 300));
      }
    } catch (e) {
      console.error(`[worker:connection] falha auditando tenant ${num.tenant_id}:`, e.message);
    }
  }
}

async function markDisconnected(num, reason) {
  await pool.query(
    `UPDATE whatsapp_numbers SET status = 'disconnected', last_checked_at = now() WHERE tenant_id = $1`,
    [num.tenant_id]
  );
  await logEvent(num.tenant_id, 'connection', 'disconnected', { reason });
}
