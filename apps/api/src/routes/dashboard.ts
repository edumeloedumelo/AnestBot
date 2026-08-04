// Dashboard: agregados operacionais do tenant (período configurável).
import { Router } from 'express';
import { getPool } from '../db.js';
import { requireAuth, requireTeam, requirePermission } from '../auth.js';

export function dashboardRouter(): Router {
  const r = Router();

  r.get('/teams/:teamId/dashboard', requireAuth, requireTeam, requirePermission('case:read'), async (req, res) => {
    const days = Math.min(365, Math.max(1, parseInt(String(req.query.days ?? '30'), 10) || 30));
    const teamId = req.team?.teamId;
    const [byStatus, pending, timing, recent] = await Promise.all([
      getPool().query(
        `SELECT status, count(*)::int AS n FROM cases
          WHERE team_id = $1 AND received_at > now() - make_interval(days => $2) GROUP BY status`,
        [teamId, days],
      ),
      getPool().query(
        `SELECT count(*)::int AS n FROM case_pending_items WHERE team_id = $1 AND status = 'open'`,
        [teamId],
      ),
      // Tempo ficha→parecer: recebimento do caso até a 1ª análise concluída.
      getPool().query(
        `SELECT avg(extract(epoch FROM (a.occurred_at - c.received_at)))::int AS avg_s
           FROM cases c JOIN case_analyses a ON a.case_id = c.id AND a.seq = 1
          WHERE c.team_id = $1 AND c.received_at > now() - make_interval(days => $2)`,
        [teamId, days],
      ),
      getPool().query(
        `SELECT c.id, c.status, c.surgery, c.received_at, p.full_name AS patient_name
           FROM cases c LEFT JOIN patients p ON p.id = c.patient_id
          WHERE c.team_id = $1 ORDER BY c.received_at DESC LIMIT 10`,
        [teamId],
      ),
    ]);
    const statusMap: Record<string, number> = {};
    for (const row of byStatus.rows as { status: string; n: number }[]) statusMap[row.status] = row.n;
    res.json({
      period_days: days,
      cases_by_status: statusMap,
      open_pending_items: (pending.rows[0] as { n: number }).n,
      avg_received_to_report_s: (timing.rows[0] as { avg_s: number | null }).avg_s,
      recent: recent.rows,
    });
  });

  return r;
}
