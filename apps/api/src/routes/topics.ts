// Biblioteca clínica: protocolos Markdown versionados com aprovação MÉDICA
// (CRM), distinção institucional × referência externa e busca em português.
// Toda resposta carrega o aviso de apoio à decisão.
import crypto from 'node:crypto';
import { Router } from 'express';
import { getPool, withTx } from '../db.js';
import { appendAudit } from '../audit.js';
import { requireAuth, requireTeam, requirePermission } from '../auth.js';
import { compile, validateBody } from '../validate.js';

export const LIBRARY_DISCLAIMER = 'Apoio à decisão — não substitui o julgamento clínico do médico responsável.';

interface TopicBody { slug: string; kind: 'institutional' | 'external_reference'; title: string; content_md: string; source_label?: string }
const topicSchema = compile<TopicBody>({
  type: 'object', additionalProperties: false,
  required: ['slug', 'kind', 'title', 'content_md'],
  properties: {
    slug: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{1,80}$' },
    kind: { type: 'string', enum: ['institutional', 'external_reference'] },
    title: { type: 'string', minLength: 2, maxLength: 200 },
    content_md: { type: 'string', minLength: 10, maxLength: 200000 },
    source_label: { type: 'string', maxLength: 300 },
  },
});

interface VersionBody { title: string; content_md: string; source_label?: string }
const versionSchema = compile<VersionBody>({
  type: 'object', additionalProperties: false,
  required: ['title', 'content_md'],
  properties: {
    title: { type: 'string', minLength: 2, maxLength: 200 },
    content_md: { type: 'string', minLength: 10, maxLength: 200000 },
    source_label: { type: 'string', maxLength: 300 },
  },
});

export function topicsRouter(): Router {
  const r = Router();
  const base = '/teams/:teamId/topics';

  r.post(base, requireAuth, requireTeam, requirePermission('library:write'),
    validateBody(topicSchema), async (req, res) => {
      const body = req.body as TopicBody;
      // Referência EXTERNA exige fonte identificada (distinção honesta —
      // seção 16 do prompt-mestre).
      if (body.kind === 'external_reference' && !body.source_label?.trim()) {
        res.status(400).json({ error: 'referência externa exige source_label (fonte identificada)' });
        return;
      }
      try {
        const out = await withTx(async (tx) => {
          const topicId = crypto.randomUUID();
          await tx.query('INSERT INTO topics (id, team_id, slug, kind) VALUES ($1, $2, $3, $4)',
            [topicId, req.team?.teamId, body.slug, body.kind]);
          const versionId = crypto.randomUUID();
          await tx.query(
            `INSERT INTO topic_versions (id, team_id, topic_id, version, title, content_md, source_label, author_id)
             VALUES ($1, $2, $3, 1, $4, $5, $6, $7)`,
            [versionId, req.team?.teamId, topicId, body.title.trim(), body.content_md, body.source_label?.trim() ?? '', req.user?.id],
          );
          await appendAudit(tx, {
            teamId: req.team?.teamId ?? null, userId: req.user?.id ?? null,
            action: 'library.topic_created', entityType: 'topic', entityId: topicId, meta: { kind: body.kind },
          });
          return { topicId, versionId };
        });
        res.status(201).json({ topic_id: out.topicId, version: 1, status: 'draft' });
      } catch (e) {
        if ((e as { code?: string }).code === '23505') { res.status(409).json({ error: 'slug já existe nesta equipe' }); return; }
        throw e;
      }
    });

  r.post(`${base}/:topicId/versions`, requireAuth, requireTeam, requirePermission('library:write'),
    validateBody(versionSchema), async (req, res) => {
      const body = req.body as VersionBody;
      const out = await withTx(async (tx) => {
        const t = await tx.query('SELECT id, kind FROM topics WHERE team_id = $1 AND id = $2 FOR UPDATE', [req.team?.teamId, req.params.topicId]);
        if (!t.rowCount) return { code: 404 as const, body: {} };
        const kind = (t.rows[0] as { kind: string }).kind;
        if (kind === 'external_reference' && !body.source_label?.trim()) {
          return { code: 400 as const, body: { error: 'referência externa exige source_label' } };
        }
        const v = await tx.query('SELECT coalesce(max(version), 0) + 1 AS next FROM topic_versions WHERE topic_id = $1', [req.params.topicId]);
        const version = (v.rows[0] as { next: number }).next;
        await tx.query(
          `INSERT INTO topic_versions (id, team_id, topic_id, version, title, content_md, source_label, author_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [crypto.randomUUID(), req.team?.teamId, req.params.topicId, version, body.title.trim(), body.content_md, body.source_label?.trim() ?? '', req.user?.id],
        );
        return { code: 201 as const, body: { version, status: 'draft' } };
      });
      res.status(out.code).json(out.body);
    });

  // Aprovação MÉDICA: exige CRM. Aposenta a versão aprovada anterior.
  r.post(`${base}/:topicId/versions/:version/approve`, requireAuth, requireTeam,
    requirePermission('library:approve'), async (req, res) => {
      const crm = req.user?.crm?.trim();
      if (!crm) { res.status(403).json({ error: 'aprovação de protocolo exige CRM no perfil (aprovador médico)' }); return; }
      const version = parseInt(String(req.params.version), 10);
      const out = await withTx(async (tx) => {
        const t = await tx.query('SELECT current_version FROM topics WHERE team_id = $1 AND id = $2 FOR UPDATE', [req.team?.teamId, req.params.topicId]);
        if (!t.rowCount) return { code: 404 as const, body: {} };
        const v = await tx.query(
          'SELECT id, status FROM topic_versions WHERE topic_id = $1 AND version = $2', [req.params.topicId, version],
        );
        if (!v.rowCount) return { code: 404 as const, body: {} };
        if ((v.rows[0] as { status: string }).status !== 'draft') {
          return { code: 409 as const, body: { error: 'só rascunhos podem ser aprovados' } };
        }
        const prev = (t.rows[0] as { current_version: number | null }).current_version;
        if (prev) {
          await tx.query(`UPDATE topic_versions SET status = 'retired' WHERE topic_id = $1 AND version = $2 AND status = 'approved'`,
            [req.params.topicId, prev]);
        }
        await tx.query(
          `UPDATE topic_versions SET status = 'approved', approved_by = $1, approved_crm = $2, approved_at = now() WHERE id = $3`,
          [req.user?.id, crm, (v.rows[0] as { id: string }).id],
        );
        await tx.query('UPDATE topics SET current_version = $1 WHERE id = $2', [version, req.params.topicId]);
        await appendAudit(tx, {
          teamId: req.team?.teamId ?? null, userId: req.user?.id ?? null,
          action: 'library.version_approved', entityType: 'topic', entityId: String(req.params.topicId), meta: { version },
        });
        return { code: 200 as const, body: { ok: true, version } };
      });
      res.status(out.code).json(out.body);
    });

  // Busca: só versões APROVADAS (vigentes), ranqueada em português.
  r.get(base, requireAuth, requireTeam, requirePermission('library:read'), async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const rows = await getPool().query(
      `SELECT t.id, t.slug, t.kind, v.version, v.title, v.approved_crm, v.approved_at, v.source_label
         FROM topics t
         JOIN topic_versions v ON v.topic_id = t.id AND v.version = t.current_version AND v.status = 'approved'
        WHERE t.team_id = $1
          AND ($2 = '' OR v.search @@ plainto_tsquery('portuguese', $2) OR v.title ILIKE '%' || $2 || '%')
        ORDER BY CASE WHEN $2 = '' THEN 0 ELSE ts_rank(v.search, plainto_tsquery('portuguese', $2)) END DESC, v.title
        LIMIT 50`,
      [req.team?.teamId, q],
    );
    res.json({ disclaimer: LIBRARY_DISCLAIMER, topics: rows.rows });
  });

  r.get(`${base}/:topicId`, requireAuth, requireTeam, requirePermission('library:read'), async (req, res) => {
    const t = await getPool().query('SELECT id, slug, kind, current_version FROM topics WHERE team_id = $1 AND id = $2', [req.team?.teamId, req.params.topicId]);
    if (!t.rowCount) { res.sendStatus(404); return; }
    const current = await getPool().query(
      `SELECT version, title, content_md, source_label, status, approved_crm, approved_at
         FROM topic_versions WHERE topic_id = $1 AND version = $2`,
      [req.params.topicId, (t.rows[0] as { current_version: number | null }).current_version],
    );
    const history = await getPool().query(
      `SELECT version, title, status, author_id, approved_crm, approved_at, created_at
         FROM topic_versions WHERE topic_id = $1 ORDER BY version DESC`,
      [req.params.topicId],
    );
    res.json({ disclaimer: LIBRARY_DISCLAIMER, topic: t.rows[0], current: current.rows[0] ?? null, history: history.rows });
  });

  return r;
}
