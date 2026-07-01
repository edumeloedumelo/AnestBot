// Provisionamento do número da cliente via UltraMsg.
//
// IMPORTANTE (nível de confiança): não há confirmação de que a UltraMsg tenha uma
// API pública pra criar uma instância nova automaticamente (o painel deles parece
// ser criação manual). Por isso o fluxo aqui assume que **o dono cria a instância
// manualmente no painel da UltraMsg** quando um tenant novo precisa (evento fica
// visível em /admin/overview como "provisionamento travado" — o worker de
// Provisionamento sinaliza isso), e só então submete instanceId/token pra cá via
// endpoint de admin. Os endpoints de QR/status abaixo usam o padrão de rota mais
// comum documentado da UltraMsg (`/{instance}/instance/qr` e `/instance/status`)
// mas **isso precisa ser confirmado contra a conta real da UltraMsg antes de ir
// pra produção** — não testei contra a API deles de verdade nesta sessão.
import { Router } from 'express';
import { pool } from '../db.js';
import { getTenant, transitionStatus, seedDefaultConfig } from '../tenants.js';
import { logEvent } from '../events.js';
import { encryptToken, decryptToken } from '../crypto.js';
import { asyncHandler } from '../asyncHandler.js';

export const provisioningRouter = Router();
// Montado em index.js sob /admin (já protegido por requireAuth+requireOwner ali).
export const adminProvisioningRouter = Router();

// GET /onboarding/status — pro app fazer polling enquanto aguarda ativação.
provisioningRouter.get('/status', asyncHandler(async (req, res) => {
  const tenant = await getTenant(req.tenantId);
  if (!tenant) return res.status(404).json({ error: 'tenant não encontrado' });
  res.json({ status: tenant.status });
}));

// GET /onboarding/qr — devolve o QR code de pareamento da instância do tenant.
provisioningRouter.get('/qr', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT provider_instance_id, provider_token_encrypted FROM whatsapp_numbers WHERE tenant_id = $1`,
    [req.tenantId]
  );
  const num = rows[0];
  if (!num?.provider_instance_id) {
    return res.status(409).json({ error: 'ainda não há instância associada a este tenant' });
  }
  const token = decryptToken(num.provider_token_encrypted);
  const url = `https://api.ultramsg.com/${num.provider_instance_id}/instance/qr?token=${encodeURIComponent(token)}`;
  const upstream = await fetch(url);
  if (!upstream.ok) return res.status(502).json({ error: 'não foi possível obter o QR agora' });
  res.set('Content-Type', upstream.headers.get('content-type') || 'image/png');
  res.send(Buffer.from(await upstream.arrayBuffer()));
}));

// POST /admin/tenants/:tenantId/attach-instance — único passo manual do dono
// (owner-only): cola instanceId+token de uma instância UltraMsg criada na mão.
adminProvisioningRouter.post('/tenants/:tenantId/attach-instance', asyncHandler(async (req, res) => {
  const { tenantId } = req.params;
  const { instanceId, token } = req.body || {};
  if (!instanceId || !token) return res.status(400).json({ error: 'instanceId e token são obrigatórios' });

  const tenant = await getTenant(tenantId);
  if (!tenant) return res.status(404).json({ error: 'tenant não encontrado' });
  if (!['provisioning', 'awaiting_pairing'].includes(tenant.status)) {
    return res.status(409).json({ error: `tenant está em status '${tenant.status}'` });
  }

  await pool.query(
    `INSERT INTO whatsapp_numbers (tenant_id, provider_instance_id, provider_token_encrypted, status)
     VALUES ($1, $2, $3, 'pending')
     ON CONFLICT (tenant_id) DO UPDATE SET
       provider_instance_id = $2, provider_token_encrypted = $3, status = 'pending', updated_at = now()`,
    [tenantId, instanceId, encryptToken(token)]
  );

  await seedDefaultConfig(tenantId);
  if (tenant.status === 'provisioning') {
    await transitionStatus(tenantId, { source: 'provisioning', to: 'awaiting_pairing', expectedVersion: tenant.status_version });
  }
  await logEvent(tenantId, 'provisioning', 'instance_attached', { instanceId });

  res.json({ status: 'awaiting_pairing' });
}));
