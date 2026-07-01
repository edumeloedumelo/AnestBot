// Painel do dono — restrito por requireOwner (montado em index.js). Mostra
// receita/custo/margem calculados ao vivo (não uma estimativa travada) e os
// alertas críticos que os workers não conseguiram resolver sozinhos.
import { Router } from 'express';
import { pool } from '../db.js';
import { staleWorkers } from '../events.js';
import { currentPeriod } from '../period.js';
import { asyncHandler } from '../asyncHandler.js';

export const adminRouter = Router();

// Ajustar conforme a fatura real do Railway crescer com a escala (ver checkpoints no plano).
const FIXED_INFRA_COST_BRL = Number(process.env.FIXED_INFRA_COST_BRL || 200);
const COST_PER_TRIAGEM_BRL = Number(process.env.COST_PER_TRIAGEM_BRL || 0.4);
const PLAN_PRICES_BRL = { starter: 247, pro: 497, clinica: 997 };

adminRouter.get('/overview', asyncHandler(async (_req, res) => {
  const period = currentPeriod();

  const { rows: activeTenants } = await pool.query(
    `SELECT id, plan FROM tenants WHERE status = 'active'`
  );
  const receitaMensal = activeTenants.reduce((sum, t) => sum + (PLAN_PRICES_BRL[t.plan] || 0), 0);

  const { rows: usageRows } = await pool.query(
    `SELECT COALESCE(SUM(count), 0) AS total FROM usage_counters WHERE period = $1`,
    [period]
  );
  const triagensNoMes = Number(usageRows[0].total);
  const custoTotal = FIXED_INFRA_COST_BRL + triagensNoMes * COST_PER_TRIAGEM_BRL;
  const margem = receitaMensal > 0 ? (receitaMensal - custoTotal) / receitaMensal : null;

  const { rows: pastDue } = await pool.query(
    `SELECT id, name, email FROM tenants WHERE status = 'past_due'`
  );
  const { rows: stuck } = await pool.query(
    `SELECT id, name, status, updated_at FROM tenants
     WHERE status IN ('provisioning', 'awaiting_pairing') AND updated_at < now() - interval '30 minutes'`
  );
  const { rows: recentFailures } = await pool.query(
    `SELECT tenant_id, source, type, created_at FROM tenant_events
     WHERE type ILIKE '%failed%' AND created_at > now() - interval '24 hours'
     ORDER BY created_at DESC LIMIT 20`
  );
  const workersTravados = await staleWorkers(5);

  res.json({
    clientesAtivos: activeTenants.length,
    receitaMensalEstimada: receitaMensal,
    custoEstimado: Math.round(custoTotal * 100) / 100,
    margem,
    alertasCriticos: {
      cobrancasFalhadas: pastDue,
      provisionamentoTravado: stuck,
      falhasRecentes: recentFailures,
      workersSemHeartbeat: workersTravados,
    },
  });
}));
