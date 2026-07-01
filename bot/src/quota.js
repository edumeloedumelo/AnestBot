// Cota mensal por tenant (limite do plano). É um limite de negócio, não uma trava
// de segurança financeira — por isso o incremento acontece só depois de cada
// triagem bem-sucedida (não cobra cota de tentativa que falhou), aceitando uma
// pequena janela de corrida só em caso raro de comandos duplicados simultâneos.
import { pool } from './db.js';

const PLAN_LIMITS = { starter: 25, pro: 100, clinica: 400 };

export function currentPeriod(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).format(date);
}

export async function getUsage(tenantId) {
  const period = currentPeriod();
  const { rows: t } = await pool.query('SELECT plan FROM tenants WHERE id = $1', [tenantId]);
  const limit = PLAN_LIMITS[t[0]?.plan] ?? PLAN_LIMITS.starter;
  const { rows } = await pool.query(
    'SELECT count FROM usage_counters WHERE tenant_id = $1 AND period = $2',
    [tenantId, period]
  );
  return { used: rows[0]?.count || 0, limit, period };
}

export async function incrementUsage(tenantId, period) {
  await pool.query(
    `INSERT INTO usage_counters (tenant_id, period, count) VALUES ($1, $2, 1)
     ON CONFLICT (tenant_id, period) DO UPDATE SET count = usage_counters.count + 1`,
    [tenantId, period]
  );
}
