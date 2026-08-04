// Casos: lista/detalhe (com redação de campos clínicos para a secretaria),
// pendências, revisão MÉDICA (CRM obrigatório) e override (CRM + motivo).
import crypto from 'node:crypto';
import { Router } from 'express';
import { getPool, withTx } from '../db.js';
import { appendAudit } from '../audit.js';
import { requireAuth, requireTeam, requirePermission } from '../auth.js';
import { can } from '../rbac.js';
import {
  validateBody, reviewSchema, overrideSchema, pendingItemSchema,
  type ReviewBody, type OverrideBody, type PendingItemBody,
} from '../validate.js';

export function casesRouter(): Router {
  const r = Router();
  const base = '/teams/:teamId/cases';

  r.get(base, requireAuth, requireTeam, requirePermission('case:read'), async (req, res) => {
    const status = String(req.query.status ?? '').trim();
    const q = await getPool().query(
      `SELECT c.id, c.status, c.surgery, c.received_at, c.patient_id, p.full_name AS patient_name,
              (SELECT count(*)::int FROM case_pending_items i WHERE i.case_id = c.id AND i.status = 'open') AS open_pending
         FROM cases c LEFT JOIN patients p ON p.id = c.patient_id
        WHERE c.team_id = $1 AND ($2 = '' OR c.status = $2)
        ORDER BY c.received_at DESC LIMIT 100`,
      [req.team?.teamId, status],
    );
    res.json({ cases: q.rows });
  });

  r.get(`${base}/:caseId`, requireAuth, requireTeam, requirePermission('case:read'), async (req, res) => {
    const q = await getPool().query(
      `SELECT c.*, p.full_name AS patient_name FROM cases c
         LEFT JOIN patients p ON p.id = c.patient_id
        WHERE c.team_id = $1 AND c.id = $2`,
      [req.team?.teamId, req.params.caseId],
    );
    if (!q.rowCount) { res.sendStatus(404); return; }

    const clinical = req.team ? can(req.team.role, 'case:read_clinical') : false;
    const pend = await getPool().query(
      'SELECT id, description, status, created_at, resolved_at FROM case_pending_items WHERE team_id = $1 AND case_id = $2 ORDER BY created_at',
      [req.team?.teamId, req.params.caseId],
    );
    const reviews = await getPool().query(
      'SELECT id, reviewer_id, reviewer_crm, decision, note, created_at FROM medical_reviews WHERE team_id = $1 AND case_id = $2 ORDER BY created_at DESC',
      [req.team?.teamId, req.params.caseId],
    );
    // Campos CLÍNICOS (anamnese/parecer/análises) só para quem tem a permissão —
    // a secretaria recebe apenas o operacional (fail-closed por omissão).
    let analyses: unknown[] = [];
    if (clinical) {
      const a = await getPool().query(
        `SELECT id, seq, patient_name, surgery, anamnesis, report_text, files, errors, model, prompt_rev, occurred_at
           FROM case_analyses WHERE team_id = $1 AND case_id = $2 ORDER BY seq DESC`,
        [req.team?.teamId, req.params.caseId],
      );
      analyses = a.rows;
    }
    await appendAudit(getPool(), {
      teamId: req.team?.teamId ?? null, userId: req.user?.id ?? null,
      action: 'case.viewed', entityType: 'case', entityId: String(req.params.caseId), meta: { clinical },
    });
    res.json({ case: q.rows[0], pending_items: pend.rows, reviews: reviews.rows, analyses, clinical_access: clinical });
  });

  r.post(`${base}/:caseId/pending-items`, requireAuth, requireTeam, requirePermission('case:manage_pending'),
    validateBody(pendingItemSchema), async (req, res) => {
      const owns = await getPool().query('SELECT 1 FROM cases WHERE team_id = $1 AND id = $2', [req.team?.teamId, req.params.caseId]);
      if (!owns.rowCount) { res.sendStatus(404); return; }
      const id = crypto.randomUUID();
      await getPool().query(
        'INSERT INTO case_pending_items (id, team_id, case_id, description, created_by) VALUES ($1, $2, $3, $4, $5)',
        [id, req.team?.teamId, req.params.caseId, (req.body as PendingItemBody).description.trim(), req.user?.id],
      );
      await appendAudit(getPool(), {
        teamId: req.team?.teamId ?? null, userId: req.user?.id ?? null,
        action: 'case.pending_created', entityType: 'case_pending_item', entityId: id,
      });
      res.status(201).json({ item_id: id });
    });

  r.post(`${base}/:caseId/pending-items/:itemId/resolve`, requireAuth, requireTeam,
    requirePermission('case:manage_pending'), async (req, res) => {
      const q = await getPool().query(
        `UPDATE case_pending_items SET status = 'resolved', resolved_by = $1, resolved_at = now()
          WHERE team_id = $2 AND case_id = $3 AND id = $4 AND status = 'open'`,
        [req.user?.id, req.team?.teamId, req.params.caseId, req.params.itemId],
      );
      if (!q.rowCount) { res.sendStatus(404); return; }
      await appendAudit(getPool(), {
        teamId: req.team?.teamId ?? null, userId: req.user?.id ?? null,
        action: 'case.pending_resolved', entityType: 'case_pending_item', entityId: String(req.params.itemId),
      });
      res.json({ ok: true });
    });

  // Revisão MÉDICA: decisão final é de médico IDENTIFICADO — CRM obrigatório
  // no perfil (403 claro sem CRM). Append-only + transição de status validada.
  r.post(`${base}/:caseId/review`, requireAuth, requireTeam, requirePermission('case:review'),
    validateBody(reviewSchema), async (req, res) => {
      const body = req.body as ReviewBody;
      const crm = req.user?.crm?.trim();
      if (!crm) { res.status(403).json({ error: 'revisão médica exige CRM no perfil do usuário' }); return; }
      const out = await withTx(async (tx) => {
        const c = await tx.query('SELECT status FROM cases WHERE team_id = $1 AND id = $2 FOR UPDATE', [req.team?.teamId, req.params.caseId]);
        if (!c.rowCount) return { code: 404 as const, body: {} };
        const status = (c.rows[0] as { status: string }).status;
        if (status !== 'analyzed' && status !== 'reviewed') {
          return { code: 409 as const, body: { error: `caso em "${status}" não pode ser revisado (aguarde a análise)` } };
        }
        const id = crypto.randomUUID();
        await tx.query(
          `INSERT INTO medical_reviews (id, team_id, case_id, reviewer_id, reviewer_crm, decision, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, req.team?.teamId, req.params.caseId, req.user?.id, crm, body.decision, body.note?.trim() ?? ''],
        );
        await tx.query(`UPDATE cases SET status = 'reviewed' WHERE id = $1`, [req.params.caseId]);
        await appendAudit(tx, {
          teamId: req.team?.teamId ?? null, userId: req.user?.id ?? null,
          action: 'case.reviewed', entityType: 'case', entityId: String(req.params.caseId), meta: { decision: body.decision },
        });
        return { code: 201 as const, body: { review_id: id } };
      });
      res.status(out.code).json(out.body);
    });

  // Override: decisão por cima do parecer — identidade + CRM + motivo + timestamp.
  r.post(`${base}/:caseId/override`, requireAuth, requireTeam, requirePermission('case:override'),
    validateBody(overrideSchema), async (req, res) => {
      const body = req.body as OverrideBody;
      const crm = req.user?.crm?.trim();
      if (!crm) { res.status(403).json({ error: 'override exige CRM no perfil do usuário' }); return; }
      const owns = await getPool().query('SELECT 1 FROM cases WHERE team_id = $1 AND id = $2', [req.team?.teamId, req.params.caseId]);
      if (!owns.rowCount) { res.sendStatus(404); return; }
      const id = crypto.randomUUID();
      await getPool().query(
        'INSERT INTO overrides (id, team_id, case_id, user_id, crm, decision, reason) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, req.team?.teamId, req.params.caseId, req.user?.id, crm, body.decision, body.reason.trim()],
      );
      await appendAudit(getPool(), {
        teamId: req.team?.teamId ?? null, userId: req.user?.id ?? null,
        action: 'case.override_recorded', entityType: 'case', entityId: String(req.params.caseId), meta: { decision: body.decision },
      });
      res.status(201).json({ override_id: id });
    });

  return r;
}
