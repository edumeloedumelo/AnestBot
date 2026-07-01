// Resolve a conexão UltraMsg (instanceId/token) de um tenant e decifra o token
// salvo pelo backend. O tenant vem da URL do webhook (/webhook/:tenantId) — cada
// instância UltraMsg tem sua própria URL de webhook configurada no painel deles,
// então não precisa de lookup reverso por instanceId como seria necessário com
// um endpoint único compartilhado.
import { pool } from './db.js';
import { decryptToken } from './crypto.js';

export async function getTenantConnection(tenantId) {
  const { rows } = await pool.query(
    `SELECT w.provider_instance_id, w.provider_token_encrypted, t.status AS tenant_status
     FROM whatsapp_numbers w
     JOIN tenants t ON t.id = w.tenant_id
     WHERE w.tenant_id = $1`,
    [tenantId]
  );
  const row = rows[0];
  if (!row) return null;

  const token = decryptToken(row.provider_token_encrypted);
  return { instanceId: row.provider_instance_id, token, tenantStatus: row.tenant_status };
}
