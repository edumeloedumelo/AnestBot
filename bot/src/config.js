// Config por tenant, lida do Postgres (tenant_configs) em vez de um config.json
// global — cada clínica tem suas próprias cirurgias/limites/prompt/admins.
import { pool } from './db.js';

export async function getConfig(tenantId) {
  const { rows } = await pool.query(
    `SELECT surgeries, exam_limits, extra_prompt, admin_numbers FROM tenant_configs WHERE tenant_id = $1`,
    [tenantId]
  );
  const row = rows[0];
  return {
    surgeries: row?.surgeries || [],
    examLimits: row?.exam_limits || [],
    extraPrompt: row?.extra_prompt || '',
    adminNumbers: row?.admin_numbers || [],
  };
}

export async function updateConfig(tenantId, mutator) {
  const config = await getConfig(tenantId);
  const draft = {
    surgeries: [...config.surgeries],
    examLimits: [...config.examLimits],
    extraPrompt: config.extraPrompt,
  };
  mutator(draft);
  await pool.query(
    `UPDATE tenant_configs SET surgeries = $1, exam_limits = $2, extra_prompt = $3, updated_at = now() WHERE tenant_id = $4`,
    [JSON.stringify(draft.surgeries), JSON.stringify(draft.examLimits), draft.extraPrompt, tenantId]
  );
  return draft;
}
