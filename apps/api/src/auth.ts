// Autenticação: registro, login (com MFA TOTP opcional), sessões opacas
// revogáveis (só o hash no banco) e middlewares de autorização.
//
// Regras: tenant e papel derivam SEMPRE da sessão + membership no banco —
// nunca de header/corpo do cliente. Acesso negado falha FECHADO (404 para
// não vazar existência de recurso de outro tenant).
import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { Router } from 'express';
import { getPool, withTx } from './db.js';
import { hashPassword, verifyPassword, newOpaqueToken, sha256, verifyTotp, newTotpSecret } from './crypto.js';
import { appendAudit } from './audit.js';
import { can, type Role, type Permission } from './rbac.js';
import { registerSchema, loginSchema, validateBody, type RegisterBody, type LoginBody } from './validate.js';

const SESSION_TTL_H = 24 * 14; // 14 dias

export interface AuthedUser { id: string; email: string; fullName: string; crm: string | null }
export interface TeamContext { teamId: string; role: Role }

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthedUser;
    team?: TeamContext;
  }
}

// ── rate limit simples em memória (fixed window) p/ endpoints de credencial ──
const buckets = new Map<string, { count: number; resetAt: number }>();
export function rateLimit(max: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.path}:${req.ip ?? 'unknown'}`;
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    b.count += 1;
    if (b.count > max) { res.status(429).json({ error: 'muitas tentativas — aguarde' }); return; }
    next();
  };
}

// ── middlewares ─────────────────────────────────────────────────────────────
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) { res.status(401).json({ error: 'não autenticado' }); return; }
  const q = await getPool().query(
    `SELECT u.id, u.email, u.full_name, u.crm
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [sha256(token)],
  );
  if (!q.rowCount) { res.status(401).json({ error: 'sessão inválida ou expirada' }); return; }
  const row = q.rows[0] as { id: string; email: string; full_name: string; crm: string | null };
  req.user = { id: row.id, email: row.email, fullName: row.full_name, crm: row.crm };
  next();
}

// Resolve o tenant do PATH e comprova membership do usuário logado.
// Sem membership ⇒ 404 (fail-closed, sem vazar que o time existe).
export async function requireTeam(req: Request, res: Response, next: NextFunction): Promise<void> {
  const teamId = String(req.params.teamId ?? '');
  if (!req.user || !/^[0-9a-f-]{36}$/i.test(teamId)) { res.sendStatus(404); return; }
  const q = await getPool().query(
    'SELECT role FROM memberships WHERE team_id = $1 AND user_id = $2',
    [teamId, req.user.id],
  );
  if (!q.rowCount) { res.sendStatus(404); return; }
  req.team = { teamId, role: (q.rows[0] as { role: Role }).role };
  next();
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.team || !can(req.team.role, permission)) {
      res.status(403).json({ error: 'sem permissão' });
      return;
    }
    next();
  };
}

// ── rotas ───────────────────────────────────────────────────────────────────
export function authRouter(): Router {
  const r = Router();

  // Cadastro: cria usuário + equipe + membership owner numa transação.
  r.post('/register', rateLimit(10, 60_000), validateBody(registerSchema), async (req, res) => {
    const body = req.body as RegisterBody;
    const email = body.email.trim().toLowerCase();
    const passwordHash = await hashPassword(body.password);
    try {
      const out = await withTx(async (tx) => {
        const dup = await tx.query('SELECT 1 FROM users WHERE email = $1', [email]);
        if (dup.rowCount) throw Object.assign(new Error('e-mail já cadastrado'), { status: 409 });
        const userId = crypto.randomUUID();
        const teamId = crypto.randomUUID();
        await tx.query(
          'INSERT INTO users (id, email, password_hash, full_name, crm) VALUES ($1, $2, $3, $4, $5)',
          [userId, email, passwordHash, body.full_name.trim(), body.crm?.trim() || null],
        );
        await tx.query(
          `INSERT INTO teams (id, name, plan, trial_ends_at) VALUES ($1, $2, 'trial', now() + interval '14 days')`,
          [teamId, body.team_name.trim()],
        );
        await tx.query(
          'INSERT INTO memberships (id, team_id, user_id, role) VALUES ($1, $2, $3, $4)',
          [crypto.randomUUID(), teamId, userId, 'owner'],
        );
        await appendAudit(tx, { teamId, userId, action: 'auth.register', entityType: 'team', entityId: teamId });
        return { userId, teamId };
      });
      res.status(201).json({ user_id: out.userId, team_id: out.teamId });
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 409) { res.status(409).json({ error: err.message }); return; }
      throw e;
    }
  });

  // Login: senha + TOTP quando habilitado. Mensagem de erro única (não vaza
  // se o e-mail existe). Auditoria de sucesso e falha.
  r.post('/login', rateLimit(5, 60_000), validateBody(loginSchema), async (req, res) => {
    const body = req.body as LoginBody;
    const email = body.email.trim().toLowerCase();
    const q = await getPool().query(
      'SELECT id, password_hash, mfa_enabled, mfa_secret FROM users WHERE email = $1', [email],
    );
    const row = q.rows[0] as { id: string; password_hash: string; mfa_enabled: boolean; mfa_secret: string | null } | undefined;
    // Sempre roda o verify (mesmo custo com e sem usuário — sem oráculo de timing).
    const ok = await verifyPassword(body.password, row?.password_hash ?? 'scrypt$16384$AAAA$AAAA');
    if (!row || !ok) {
      await appendAudit(getPool(), { userId: row?.id ?? null, action: 'auth.login_failed' });
      res.status(401).json({ error: 'credenciais inválidas' });
      return;
    }
    if (row.mfa_enabled) {
      if (!body.totp || !row.mfa_secret || !verifyTotp(row.mfa_secret, body.totp)) {
        await appendAudit(getPool(), { userId: row.id, action: 'auth.login_mfa_failed' });
        res.status(401).json({ error: 'código MFA obrigatório ou inválido', mfa_required: true });
        return;
      }
    }
    const { token, hash } = newOpaqueToken();
    await getPool().query(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '${SESSION_TTL_H} hours')`,
      [crypto.randomUUID(), row.id, hash],
    );
    await appendAudit(getPool(), { userId: row.id, action: 'auth.login' });
    res.json({ token });
  });

  // Logout: revoga a sessão atual (o token deixa de valer imediatamente).
  r.post('/logout', requireAuth, async (req, res) => {
    const token = (req.headers.authorization ?? '').slice(7);
    await getPool().query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1', [sha256(token)]);
    await appendAudit(getPool(), { userId: req.user?.id ?? null, action: 'auth.logout' });
    res.json({ ok: true });
  });

  // Revoga TODAS as sessões do usuário (troca de aparelho/comprometimento).
  r.post('/logout-all', requireAuth, async (req, res) => {
    await getPool().query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [req.user?.id]);
    await appendAudit(getPool(), { userId: req.user?.id ?? null, action: 'auth.logout_all' });
    res.json({ ok: true });
  });

  // MFA (TOTP): enrollment em dois passos — gera segredo, confirma com código.
  r.post('/mfa/setup', requireAuth, async (req, res) => {
    const secret = newTotpSecret();
    await getPool().query('UPDATE users SET mfa_secret = $1, mfa_enabled = false WHERE id = $2', [secret, req.user?.id]);
    res.json({ secret, otpauth: `otpauth://totp/ANESTBOT:${req.user?.email}?secret=${secret}&issuer=ANESTBOT` });
  });
  r.post('/mfa/confirm', requireAuth, rateLimit(5, 60_000), async (req, res) => {
    const code = String((req.body as { totp?: string })?.totp ?? '');
    const q = await getPool().query('SELECT mfa_secret FROM users WHERE id = $1', [req.user?.id]);
    const secret = (q.rows[0] as { mfa_secret: string | null } | undefined)?.mfa_secret;
    if (!secret || !verifyTotp(secret, code)) { res.status(400).json({ error: 'código inválido' }); return; }
    await getPool().query('UPDATE users SET mfa_enabled = true WHERE id = $1', [req.user?.id]);
    await appendAudit(getPool(), { userId: req.user?.id ?? null, action: 'auth.mfa_enabled' });
    res.json({ ok: true });
  });

  // Perfil + equipes do usuário logado.
  r.get('/me', requireAuth, async (req, res) => {
    const teams = await getPool().query(
      `SELECT m.team_id, m.role, t.name FROM memberships m JOIN teams t ON t.id = m.team_id WHERE m.user_id = $1`,
      [req.user?.id],
    );
    res.json({ user: req.user, teams: teams.rows });
  });

  return r;
}
