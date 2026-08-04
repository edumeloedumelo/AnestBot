// Prontuário anestésico: rascunho → eventos/vitais → assinatura (hash) → adendos.
// Registro assinado é IMUTÁVEL (trigger no banco); correção = adendo com CRM.
import crypto from 'node:crypto';
import { Router } from 'express';
import { getPool, withTx } from '../db.js';
import { appendAudit } from '../audit.js';
import { requireAuth, requireTeam, requirePermission } from '../auth.js';
import { snapshotHash, type RecordSnapshot } from '../canonical.js';
import { compile, validateBody } from '../validate.js';

interface RecordBody { case_id?: string; patient_id?: string; template_id?: string; pre?: object; intra?: object; post?: object }
const recordSchema = compile<RecordBody>({
  type: 'object', additionalProperties: false,
  properties: {
    case_id: { type: 'string', format: 'uuid' },
    patient_id: { type: 'string', format: 'uuid' },
    template_id: { type: 'string', format: 'uuid' },
    pre: { type: 'object' }, intra: { type: 'object' }, post: { type: 'object' },
  },
});

interface EventBody { at: string; kind: 'drug' | 'airway' | 'event' | 'note'; description: string; dose?: string }
const eventSchema = compile<EventBody>({
  type: 'object', additionalProperties: false,
  required: ['at', 'kind', 'description'],
  properties: {
    at: { type: 'string', format: 'date-time' },
    kind: { type: 'string', enum: ['drug', 'airway', 'event', 'note'] },
    description: { type: 'string', minLength: 1, maxLength: 500 },
    dose: { type: 'string', maxLength: 120 },
  },
});

interface VitalBody { at: string; hr?: number; sbp?: number; dbp?: number; spo2?: number; temp_c?: number }
const vitalSchema = compile<VitalBody>({
  type: 'object', additionalProperties: false,
  required: ['at'],
  properties: {
    at: { type: 'string', format: 'date-time' },
    hr: { type: 'integer', minimum: 0, maximum: 400 },
    sbp: { type: 'integer', minimum: 0, maximum: 400 },
    dbp: { type: 'integer', minimum: 0, maximum: 400 },
    spo2: { type: 'integer', minimum: 0, maximum: 100 },
    temp_c: { type: 'number', minimum: 20, maximum: 45 },
  },
});

interface AddendumBody { content: string }
const addendumSchema = compile<AddendumBody>({
  type: 'object', additionalProperties: false,
  required: ['content'],
  properties: { content: { type: 'string', minLength: 5, maxLength: 5000 } },
});

interface TemplateBody { name: string; content?: object }
const templateSchema = compile<TemplateBody>({
  type: 'object', additionalProperties: false,
  required: ['name'],
  properties: { name: { type: 'string', minLength: 2, maxLength: 120 }, content: { type: 'object' } },
});

async function loadRecord(teamId: string, recordId: string): Promise<{ id: string; status: string } | null> {
  const q = await getPool().query('SELECT id, status FROM anesthesia_records WHERE team_id = $1 AND id = $2', [teamId, recordId]);
  return q.rowCount ? (q.rows[0] as { id: string; status: string }) : null;
}

// Monta o snapshot canônico do registro (mesma função na assinatura e na verificação).
async function buildSnapshot(teamId: string, recordId: string): Promise<RecordSnapshot | null> {
  const r = await getPool().query(
    'SELECT id, team_id, case_id, patient_id, pre, intra, post FROM anesthesia_records WHERE team_id = $1 AND id = $2',
    [teamId, recordId],
  );
  if (!r.rowCount) return null;
  const rec = r.rows[0] as { id: string; team_id: string; case_id: string | null; patient_id: string | null; pre: object; intra: object; post: object };
  const ev = await getPool().query(
    'SELECT at, kind, description, dose FROM anesthesia_events WHERE record_id = $1 ORDER BY at, id', [recordId],
  );
  const vi = await getPool().query(
    'SELECT at, hr, sbp, dbp, spo2, temp_c, extra FROM vitals WHERE record_id = $1 ORDER BY at, id', [recordId],
  );
  return {
    record_id: rec.id, team_id: rec.team_id, case_id: rec.case_id, patient_id: rec.patient_id,
    pre: rec.pre as never, intra: rec.intra as never, post: rec.post as never,
    events: (ev.rows as { at: Date; kind: string; description: string; dose: string }[])
      .map((e) => ({ at: new Date(e.at).toISOString(), kind: e.kind, description: e.description, dose: e.dose })),
    vitals: (vi.rows as { at: Date; hr: number | null; sbp: number | null; dbp: number | null; spo2: number | null; temp_c: string | null; extra: object }[])
      .map((v) => ({ at: new Date(v.at).toISOString(), hr: v.hr, sbp: v.sbp, dbp: v.dbp, spo2: v.spo2, temp_c: v.temp_c, extra: v.extra as never })),
  };
}

export function recordsRouter(): Router {
  const r = Router();
  const base = '/teams/:teamId/records';

  r.get(base, requireAuth, requireTeam, requirePermission('record:read'), async (req, res) => {
    const caseId = String(req.query.case_id ?? '').trim();
    const q = await getPool().query(
      `SELECT id, case_id, patient_id, status, created_by, created_at, updated_at
         FROM anesthesia_records WHERE team_id = $1 AND ($2 = '' OR case_id::text = $2)
        ORDER BY created_at DESC LIMIT 100`,
      [req.team?.teamId, caseId],
    );
    res.json({ records: q.rows });
  });

  r.post(base, requireAuth, requireTeam, requirePermission('record:write'),
    validateBody(recordSchema), async (req, res) => {
      const body = req.body as RecordBody;
      // FKs sempre validadas DENTRO do tenant (nunca aceitar id de outro time).
      if (body.case_id) {
        const c = await getPool().query('SELECT 1 FROM cases WHERE team_id = $1 AND id = $2', [req.team?.teamId, body.case_id]);
        if (!c.rowCount) { res.sendStatus(404); return; }
      }
      if (body.patient_id) {
        const p = await getPool().query('SELECT 1 FROM patients WHERE team_id = $1 AND id = $2', [req.team?.teamId, body.patient_id]);
        if (!p.rowCount) { res.sendStatus(404); return; }
      }
      let template: { pre?: object; intra?: object; post?: object } = {};
      if (body.template_id) {
        const t = await getPool().query('SELECT content FROM record_templates WHERE team_id = $1 AND id = $2', [req.team?.teamId, body.template_id]);
        if (!t.rowCount) { res.sendStatus(404); return; }
        template = (t.rows[0] as { content: { pre?: object; intra?: object; post?: object } }).content ?? {};
      }
      const id = crypto.randomUUID();
      await getPool().query(
        `INSERT INTO anesthesia_records (id, team_id, case_id, patient_id, pre, intra, post, template_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, req.team?.teamId, body.case_id ?? null, body.patient_id ?? null,
         JSON.stringify(body.pre ?? template.pre ?? {}), JSON.stringify(body.intra ?? template.intra ?? {}),
         JSON.stringify(body.post ?? template.post ?? {}), body.template_id ?? null, req.user?.id],
      );
      await appendAudit(getPool(), {
        teamId: req.team?.teamId ?? null, userId: req.user?.id ?? null,
        action: 'record.created', entityType: 'anesthesia_record', entityId: id,
      });
      res.status(201).json({ record_id: id });
    });

  r.get(`${base}/:recordId`, requireAuth, requireTeam, requirePermission('record:read'), async (req, res) => {
    const rec = await getPool().query(
      'SELECT * FROM anesthesia_records WHERE team_id = $1 AND id = $2', [req.team?.teamId, req.params.recordId],
    );
    if (!rec.rowCount) { res.sendStatus(404); return; }
    const [events, vitals, sig, addenda] = await Promise.all([
      getPool().query('SELECT id, at, kind, description, dose, created_by FROM anesthesia_events WHERE record_id = $1 ORDER BY at, id', [req.params.recordId]),
      getPool().query('SELECT id, at, hr, sbp, dbp, spo2, temp_c, extra FROM vitals WHERE record_id = $1 ORDER BY at, id', [req.params.recordId]),
      getPool().query('SELECT signer_id, signer_crm, content_hash, signed_at FROM signatures WHERE record_id = $1', [req.params.recordId]),
      getPool().query('SELECT id, author_id, author_crm, content, created_at FROM record_addenda WHERE record_id = $1 ORDER BY created_at', [req.params.recordId]),
    ]);
    // Verificação de integridade: hash do conteúdo ATUAL vs. hash assinado.
    let verification: { verified: boolean; content_hash: string } | null = null;
    if (sig.rowCount) {
      const snapshot = await buildSnapshot(String(req.team?.teamId), String(req.params.recordId));
      const stored = (sig.rows[0] as { content_hash: string }).content_hash;
      verification = { verified: snapshot ? snapshotHash(snapshot).hash === stored : false, content_hash: stored };
    }
    await appendAudit(getPool(), {
      teamId: req.team?.teamId ?? null, userId: req.user?.id ?? null,
      action: 'record.viewed', entityType: 'anesthesia_record', entityId: String(req.params.recordId),
    });
    res.json({ record: rec.rows[0], events: events.rows, vitals: vitals.rows, signature: sig.rows[0] ?? null, addenda: addenda.rows, verification });
  });

  r.put(`${base}/:recordId`, requireAuth, requireTeam, requirePermission('record:write'),
    validateBody(recordSchema), async (req, res) => {
      const body = req.body as RecordBody;
      const rec = await loadRecord(String(req.team?.teamId), String(req.params.recordId));
      if (!rec) { res.sendStatus(404); return; }
      if (rec.status === 'signed') { res.status(409).json({ error: 'registro assinado é imutável — use um adendo' }); return; }
      await getPool().query(
        `UPDATE anesthesia_records SET
           pre = coalesce($1, pre), intra = coalesce($2, intra), post = coalesce($3, post), updated_at = now()
         WHERE team_id = $4 AND id = $5 AND status = 'draft'`,
        [body.pre ? JSON.stringify(body.pre) : null, body.intra ? JSON.stringify(body.intra) : null,
         body.post ? JSON.stringify(body.post) : null, req.team?.teamId, req.params.recordId],
      );
      await appendAudit(getPool(), {
        teamId: req.team?.teamId ?? null, userId: req.user?.id ?? null,
        action: 'record.updated', entityType: 'anesthesia_record', entityId: String(req.params.recordId),
      });
      res.json({ ok: true });
    });

  r.post(`${base}/:recordId/events`, requireAuth, requireTeam, requirePermission('record:write'),
    validateBody(eventSchema), async (req, res) => {
      const body = req.body as EventBody;
      const rec = await loadRecord(String(req.team?.teamId), String(req.params.recordId));
      if (!rec) { res.sendStatus(404); return; }
      if (rec.status === 'signed') { res.status(409).json({ error: 'registro assinado é imutável — use um adendo' }); return; }
      const id = crypto.randomUUID();
      await getPool().query(
        'INSERT INTO anesthesia_events (id, team_id, record_id, at, kind, description, dose, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [id, req.team?.teamId, req.params.recordId, body.at, body.kind, body.description.trim(), body.dose ?? '', req.user?.id],
      );
      res.status(201).json({ event_id: id });
    });

  r.post(`${base}/:recordId/vitals`, requireAuth, requireTeam, requirePermission('record:write'),
    validateBody(vitalSchema), async (req, res) => {
      const body = req.body as VitalBody;
      const rec = await loadRecord(String(req.team?.teamId), String(req.params.recordId));
      if (!rec) { res.sendStatus(404); return; }
      if (rec.status === 'signed') { res.status(409).json({ error: 'registro assinado é imutável — use um adendo' }); return; }
      const id = crypto.randomUUID();
      await getPool().query(
        'INSERT INTO vitals (id, team_id, record_id, at, hr, sbp, dbp, spo2, temp_c, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [id, req.team?.teamId, req.params.recordId, body.at, body.hr ?? null, body.sbp ?? null, body.dbp ?? null, body.spo2 ?? null, body.temp_c ?? null, req.user?.id],
      );
      res.status(201).json({ vital_id: id });
    });

  // Assinatura: congela snapshot canônico + sha256. Exige CRM (médico identificado).
  // NÃO é assinatura eletrônica qualificada (ICP-Brasil) — é registro de autoria
  // com integridade verificável; a qualificação jurídica é etapa futura.
  r.post(`${base}/:recordId/sign`, requireAuth, requireTeam, requirePermission('record:sign'), async (req, res) => {
    const crm = req.user?.crm?.trim();
    if (!crm) { res.status(403).json({ error: 'assinatura exige CRM no perfil do usuário' }); return; }
    const out = await withTx(async (tx) => {
      const cur = await tx.query(
        'SELECT status FROM anesthesia_records WHERE team_id = $1 AND id = $2 FOR UPDATE', [req.team?.teamId, req.params.recordId],
      );
      if (!cur.rowCount) return { code: 404 as const, body: {} };
      if ((cur.rows[0] as { status: string }).status === 'signed') return { code: 409 as const, body: { error: 'registro já assinado' } };

      const snapshot = await buildSnapshot(String(req.team?.teamId), String(req.params.recordId));
      if (!snapshot) return { code: 404 as const, body: {} };
      const { canonical, hash } = snapshotHash(snapshot);
      const sigId = crypto.randomUUID();
      await tx.query(
        `INSERT INTO signatures (id, team_id, record_id, signer_id, signer_crm, content_hash, canonical)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [sigId, req.team?.teamId, req.params.recordId, req.user?.id, crm, hash, canonical],
      );
      // Última mutação permitida do registro: draft → signed.
      await tx.query(`UPDATE anesthesia_records SET status = 'signed', updated_at = now() WHERE id = $1`, [req.params.recordId]);
      await appendAudit(tx, {
        teamId: req.team?.teamId ?? null, userId: req.user?.id ?? null,
        action: 'record.signed', entityType: 'anesthesia_record', entityId: String(req.params.recordId),
        meta: { content_hash: hash },
      });
      return { code: 201 as const, body: { signature_id: sigId, content_hash: hash } };
    });
    res.status(out.code).json(out.body);
  });

  // Adendo: só em registro ASSINADO (rascunho se edita direto), com CRM.
  r.post(`${base}/:recordId/addenda`, requireAuth, requireTeam, requirePermission('record:sign'),
    validateBody(addendumSchema), async (req, res) => {
      const crm = req.user?.crm?.trim();
      if (!crm) { res.status(403).json({ error: 'adendo exige CRM no perfil do usuário' }); return; }
      const rec = await loadRecord(String(req.team?.teamId), String(req.params.recordId));
      if (!rec) { res.sendStatus(404); return; }
      if (rec.status !== 'signed') { res.status(409).json({ error: 'adendo é para registro assinado — edite o rascunho diretamente' }); return; }
      const id = crypto.randomUUID();
      await getPool().query(
        'INSERT INTO record_addenda (id, team_id, record_id, author_id, author_crm, content) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, req.team?.teamId, req.params.recordId, req.user?.id, crm, (req.body as AddendumBody).content.trim()],
      );
      await appendAudit(getPool(), {
        teamId: req.team?.teamId ?? null, userId: req.user?.id ?? null,
        action: 'record.addendum_added', entityType: 'anesthesia_record', entityId: String(req.params.recordId),
      });
      res.status(201).json({ addendum_id: id });
    });

  // Templates versionados (mesmo nome ⇒ versão incrementa; nada é sobrescrito).
  r.post('/teams/:teamId/record-templates', requireAuth, requireTeam, requirePermission('record:write'),
    validateBody(templateSchema), async (req, res) => {
      const body = req.body as TemplateBody;
      const out = await withTx(async (tx) => {
        const v = await tx.query(
          'SELECT coalesce(max(version), 0) + 1 AS next FROM record_templates WHERE team_id = $1 AND name = $2',
          [req.team?.teamId, body.name.trim()],
        );
        const version = (v.rows[0] as { next: number }).next;
        const id = crypto.randomUUID();
        await tx.query(
          'INSERT INTO record_templates (id, team_id, name, version, content, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
          [id, req.team?.teamId, body.name.trim(), version, JSON.stringify(body.content ?? {}), req.user?.id],
        );
        return { id, version };
      });
      res.status(201).json({ template_id: out.id, version: out.version });
    });

  r.get('/teams/:teamId/record-templates', requireAuth, requireTeam, requirePermission('record:read'), async (req, res) => {
    const q = await getPool().query(
      `SELECT DISTINCT ON (name) id, name, version, content, created_at
         FROM record_templates WHERE team_id = $1 ORDER BY name, version DESC`,
      [req.team?.teamId],
    );
    res.json({ templates: q.rows });
  });

  return r;
}
