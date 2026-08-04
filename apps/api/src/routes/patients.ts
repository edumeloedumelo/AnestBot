// Pacientes: cadastro mínimo, histórico, alertas críticos e sugestão de
// duplicatas (deduplicação ASSISTIDA — nunca fusão automática).
import crypto from 'node:crypto';
import { Router } from 'express';
import { getPool } from '../db.js';
import { appendAudit } from '../audit.js';
import { requireAuth, requireTeam, requirePermission } from '../auth.js';
import { validateBody, patientSchema, type PatientBody } from '../validate.js';

export function patientsRouter(): Router {
  const r = Router();
  const base = '/teams/:teamId/patients';

  r.get(base, requireAuth, requireTeam, requirePermission('patient:read'), async (req, res) => {
    const search = String(req.query.q ?? '').trim();
    const q = await getPool().query(
      `SELECT id, full_name, birth_date, phone, insurer, created_at
         FROM patients
        WHERE team_id = $1 AND ($2 = '' OR lower(full_name) LIKE '%' || lower($2) || '%')
        ORDER BY full_name LIMIT 100`,
      [req.team?.teamId, search],
    );
    res.json({ patients: q.rows });
  });

  r.post(base, requireAuth, requireTeam, requirePermission('patient:write'),
    validateBody(patientSchema), async (req, res) => {
      const body = req.body as PatientBody;
      const id = crypto.randomUUID();
      // Sugestão de duplicata: homônimos do MESMO tenant são reportados, nunca fundidos.
      const dupes = await getPool().query(
        'SELECT id, full_name FROM patients WHERE team_id = $1 AND lower(full_name) = lower($2)',
        [req.team?.teamId, body.full_name.trim()],
      );
      await getPool().query(
        'INSERT INTO patients (id, team_id, full_name, birth_date, phone, insurer) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, req.team?.teamId, body.full_name.trim(), body.birth_date ?? null, body.phone ?? null, body.insurer ?? null],
      );
      await appendAudit(getPool(), {
        teamId: req.team?.teamId ?? null, userId: req.user?.id ?? null,
        action: 'patient.created', entityType: 'patient', entityId: id,
      });
      res.status(201).json({ patient_id: id, possible_duplicates: dupes.rows });
    });

  r.get(`${base}/:patientId`, requireAuth, requireTeam, requirePermission('patient:read'), async (req, res) => {
    const q = await getPool().query(
      'SELECT id, full_name, birth_date, phone, insurer, created_at FROM patients WHERE team_id = $1 AND id = $2',
      [req.team?.teamId, req.params.patientId],
    );
    if (!q.rowCount) { res.sendStatus(404); return; }
    const alerts = await getPool().query(
      'SELECT id, kind, description, created_at FROM patient_alerts WHERE team_id = $1 AND patient_id = $2 ORDER BY created_at DESC',
      [req.team?.teamId, req.params.patientId],
    );
    const cases = await getPool().query(
      'SELECT id, status, surgery, received_at FROM cases WHERE team_id = $1 AND patient_id = $2 ORDER BY received_at DESC LIMIT 50',
      [req.team?.teamId, req.params.patientId],
    );
    // Trilha de acesso a dados do paciente (LGPD): quem viu, quando.
    await appendAudit(getPool(), {
      teamId: req.team?.teamId ?? null, userId: req.user?.id ?? null,
      action: 'patient.viewed', entityType: 'patient', entityId: String(req.params.patientId),
    });
    res.json({ patient: q.rows[0], alerts: alerts.rows, cases: cases.rows });
  });

  r.post(`${base}/:patientId/alerts`, requireAuth, requireTeam, requirePermission('patient:write'), async (req, res) => {
    const body = req.body as { kind?: string; description?: string };
    const kind = ['allergy', 'difficult_airway', 'prior_event', 'other'].includes(body.kind ?? '') ? body.kind : null;
    const description = (body.description ?? '').trim();
    if (!kind || !description || description.length > 500) { res.status(400).json({ error: 'kind/description inválidos' }); return; }
    const owns = await getPool().query('SELECT 1 FROM patients WHERE team_id = $1 AND id = $2', [req.team?.teamId, req.params.patientId]);
    if (!owns.rowCount) { res.sendStatus(404); return; }
    const id = crypto.randomUUID();
    await getPool().query(
      'INSERT INTO patient_alerts (id, team_id, patient_id, kind, description, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, req.team?.teamId, req.params.patientId, kind, description, req.user?.id],
    );
    await appendAudit(getPool(), {
      teamId: req.team?.teamId ?? null, userId: req.user?.id ?? null,
      action: 'patient.alert_created', entityType: 'patient_alert', entityId: id, meta: { kind },
    });
    res.status(201).json({ alert_id: id });
  });

  return r;
}
