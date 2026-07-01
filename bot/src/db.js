// Pool Postgres — mesmo banco do backend/ (tenants, tenant_configs, usage_counters,
// triage_audit_log, tenant_events). O bot é "data plane": lê/escreve por tenant,
// mas quem é dono da máquina de estados de status é o backend.
import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});
