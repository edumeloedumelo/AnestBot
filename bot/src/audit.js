// Log mínimo não-identificável (nunca nome de paciente, exame ou anamnese) +
// eventos pro worker de Execução do backend detectar falha sistêmica.
import { pool } from './db.js';

export async function recordTriageOutcome(tenantId, statusFinal) {
  await pool.query(
    `INSERT INTO triage_audit_log (tenant_id, status_final) VALUES ($1, $2)`,
    [tenantId, statusFinal]
  );
}

export async function logExecutionEvent(tenantId, type, payload = {}) {
  await pool.query(
    `INSERT INTO tenant_events (tenant_id, source, type, payload) VALUES ($1, 'execution', $2, $3)`,
    [tenantId, type, JSON.stringify(payload)]
  );
}

// Best-effort: só pra rastreabilidade/painel, nunca usado pra decidir a resposta
// que a médica recebe (essa vem sempre do texto que o Claude gerou).
export function extractStatusFinal(text) {
  const line = (text.match(/STATUS:?\**\s*([^\n]+)/i) || [])[1] || text;
  if (/N[ÃA]O LIBERAR/i.test(line)) return 'nao_liberar';
  if (/PENDENTE/i.test(line)) return 'pendente';
  if (/RESSALVAS/i.test(line)) return 'liberado_com_ressalvas';
  if (/LIBERADO/i.test(line)) return 'liberado';
  return 'desconhecido';
}
