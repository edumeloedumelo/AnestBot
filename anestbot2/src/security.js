// Segurança de borda do bot: autenticação do webhook, readiness e diagnóstico.
//
// D-001/D-003 (docs/DECISIONS.md): endurecimento RETROCOMPATÍVEL. Com
// WEBHOOK_TOKEN configurado, requisição sem token válido recebe 401 e NÃO é
// processada. Sem a env, o bot aceita como antes — mas avisa alto no boot,
// para nunca derrubar a produção que ainda não configurou a variável.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Comparação constant-time — nunca comparar segredos com ===.
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Decide o acesso ao /webhook. Retorna null (autorizado) ou o motivo da recusa.
// O token viaja na URL configurada no painel UltraMsg: /webhook?token=SEGREDO
// (o UltraMsg não suporta assinatura HMAC de webhook — D-003).
export function webhookAuthDecision(query, token = process.env.WEBHOOK_TOKEN || '') {
  if (!token) return null; // modo compatibilidade (avisado no boot)
  if (!query || typeof query.token !== 'string' || !query.token) return 'token ausente';
  if (!safeEqual(query.token, token)) return 'token inválido';
  return null;
}

// Readiness (/ready): dependências essenciais para o bot OPERAR de fato.
// /health continua liveness pura — processo vivo responde 200 sempre.
export function readinessCheck(env = process.env) {
  const dir = env.STATE_DIR || '/data';
  let stateDirWritable = false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.ready-probe');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    stateDirWritable = true;
  } catch { /* segue false */ }
  const checks = {
    state_dir_writable: stateDirWritable,
    ultramsg_configured: !!(env.ULTRAMSG_INSTANCE_ID && env.ULTRAMSG_TOKEN),
    anthropic_configured: !!env.ANTHROPIC_API_KEY,
    // Informativos (não bloqueiam readiness — modo compatibilidade D-001):
    webhook_token_configured: !!env.WEBHOOK_TOKEN,
    admin_numbers_configured: !!(env.ADMIN_NUMBERS || '').trim(),
  };
  const ready = checks.state_dir_writable && checks.ultramsg_configured && checks.anthropic_configured;
  return { ready, checks };
}

// Acesso ao /diag: fail-closed — sem DIAG_TOKEN configurado o endpoint nem
// existe (404), e token errado também recebe 404 (não revela a existência).
export function diagAuthorized(query, token = process.env.DIAG_TOKEN || '') {
  if (!token) return false;
  return !!query && typeof query.token === 'string' && safeEqual(query.token, token);
}
