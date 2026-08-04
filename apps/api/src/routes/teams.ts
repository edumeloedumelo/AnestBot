// Equipe: membros, convites (uso único + expiração) e pareamento WhatsApp.
import crypto from 'node:crypto';
import { Router } from 'express';
import { getPool, withTx } from '../db.js';
import { newOpaqueToken, sha256, hashPassword } from '../crypto.js';
import { appendAudit } from '../audit.js';
import { requireAuth, requireTeam, requirePermission, rateLimit } from '../auth.js';
import {
  validateBody, inviteSchema, acceptInviteSchema, pairingSchema,
  type InviteBody, type AcceptInviteBody, type PairingBody,
} from '../validate.js';

const INVITE_TTL_H = 72;

export function teamsRouter(): Router {
  const r = Router();

  r.get('/teams/:teamId', requireAuth, requireTeam, async (req, res) => {
    const q = await getPool().query('SELECT id, name, plan, trial_ends_at, created_at FROM teams WHERE id = $1', [req.team?.teamId]);
    res.json({ team: q.rows[0], role: req.team?.role });
  });

  r.get('/teams/:teamId/members', requireAuth, requireTeam, async (req, res) => {
    const q = await getPool().query(
      `SELECT m.role, u.id, u.full_name, u.email, u.crm
         FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.team_id = $1 ORDER BY m.created_at`,
      [req.team?.teamId],
    );
    res.json({ members: q.rows });
  });

  // Convite: token de uso único com expiração; o link viaja fora do banco.
  r.post('/teams/:teamId/invites', requireAuth, requireTeam, requirePermission('invite:create'),
    validateBody(inviteSchema), async (req, res) => {
      const body = req.body as InviteBody;
      const { token, hash } = newOpaqueToken();
      const inviteId = crypto.randomUUID();
      await getPool().query(
        `INSERT INTO invites (id, team_id, email, role, token_hash, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, now() + interval '${INVITE_TTL_H} hours')`,
        [inviteId, req.team?.teamId, body.email.trim().toLowerCase(), body.role, hash, req.user?.id],
      );
      await appendAudit(getPool(), {
        teamId: req.team?.teamId ?? null, userId: req.user?.id ?? null,
        action: 'invite.created', entityType: 'invite', entityId: inviteId, meta: { role: body.role },
      });
      res.status(201).json({ invite_id: inviteId, token, expires_in_hours: INVITE_TTL_H });
    });

  // Aceite do convite (sem login prévio): cria a conta se o e-mail for novo.
  r.post('/invites/accept', rateLimit(10, 60_000), validateBody(acceptInviteSchema), async (req, res) => {
    const body = req.body as AcceptInviteBody;
    try {
      const out = await withTx(async (tx) => {
        const q = await tx.query(
          `SELECT id, team_id, email, role, expires_at, used_at FROM invites WHERE token_hash = $1 FOR UPDATE`,
          [sha256(body.token)],
        );
        if (!q.rowCount) throw Object.assign(new Error('convite inválido'), { status: 404 });
        const inv = q.rows[0] as { id: string; team_id: string; email: string; role: string; expires_at: Date; used_at: Date | null };
        if (inv.used_at) throw Object.assign(new Error('convite já utilizado'), { status: 410 });
        if (new Date(inv.expires_at).getTime() < Date.now()) throw Object.assign(new Error('convite expirado'), { status: 410 });

        const uq = await tx.query('SELECT id FROM users WHERE email = $1', [inv.email]);
        let userId: string;
        if (uq.rowCount) {
          userId = (uq.rows[0] as { id: string }).id;
        } else {
          if (!body.password || !body.full_name) throw Object.assign(new Error('password e full_name são obrigatórios para conta nova'), { status: 400 });
          userId = crypto.randomUUID();
          await tx.query(
            'INSERT INTO users (id, email, password_hash, full_name, crm) VALUES ($1, $2, $3, $4, $5)',
            [userId, inv.email, await hashPassword(body.password), body.full_name.trim(), body.crm?.trim() || null],
          );
        }
        const dup = await tx.query('SELECT 1 FROM memberships WHERE team_id = $1 AND user_id = $2', [inv.team_id, userId]);
        if (!dup.rowCount) {
          await tx.query('INSERT INTO memberships (id, team_id, user_id, role) VALUES ($1, $2, $3, $4)',
            [crypto.randomUUID(), inv.team_id, userId, inv.role]);
        }
        await tx.query('UPDATE invites SET used_at = now() WHERE id = $1', [inv.id]);
        await appendAudit(tx, { teamId: inv.team_id, userId, action: 'invite.accepted', entityType: 'invite', entityId: inv.id, meta: { role: inv.role } });
        return { teamId: inv.team_id, userId };
      });
      res.json({ team_id: out.teamId, user_id: out.userId });
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status) { res.status(err.status).json({ error: err.message }); return; }
      throw e;
    }
  });

  // Pareamento grupo WhatsApp ⇄ tenant (chat_ref é único GLOBALMENTE).
  r.post('/teams/:teamId/whatsapp-links', requireAuth, requireTeam, requirePermission('pairing:manage'),
    validateBody(pairingSchema), async (req, res) => {
      const body = req.body as PairingBody;
      try {
        const id = crypto.randomUUID();
        await getPool().query(
          'INSERT INTO whatsapp_links (id, team_id, chat_ref, label, created_by) VALUES ($1, $2, $3, $4, $5)',
          [id, req.team?.teamId, body.chat_ref.trim(), body.label?.trim() ?? '', req.user?.id],
        );
        await appendAudit(getPool(), {
          teamId: req.team?.teamId ?? null, userId: req.user?.id ?? null,
          action: 'pairing.created', entityType: 'whatsapp_link', entityId: id,
        });
        res.status(201).json({ link_id: id });
      } catch (e) {
        if ((e as { code?: string }).code === '23505') { res.status(409).json({ error: 'este grupo já está pareado' }); return; }
        throw e;
      }
    });

  r.get('/teams/:teamId/whatsapp-links', requireAuth, requireTeam, requirePermission('pairing:manage'), async (req, res) => {
    const q = await getPool().query(
      'SELECT id, chat_ref, label, created_at FROM whatsapp_links WHERE team_id = $1 ORDER BY created_at', [req.team?.teamId],
    );
    res.json({ links: q.rows });
  });

  r.get('/teams/:teamId/audit', requireAuth, requireTeam, requirePermission('audit:read'), async (req, res) => {
    const q = await getPool().query(
      `SELECT id, user_id, action, entity_type, entity_id, meta, created_at
         FROM audit_logs WHERE team_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [req.team?.teamId],
    );
    res.json({ entries: q.rows });
  });

  return r;
}
