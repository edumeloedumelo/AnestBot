// Máquina de estados dos tenants. Todos os workers passam por aqui — nenhum
// deles escreve em `tenants.status` direto, pra manter a regra de conflito
// centralizada num único lugar (cancelamento sempre vence sobre ativação em curso).
import { pool } from './db.js';
import { logEvent } from './events.js';

export const STATUSES = [
  'pending_payment',
  'provisioning',
  'awaiting_pairing',
  'active',
  'past_due',
  'canceled',
];

// Nenhum worker de provisionamento/conexão pode mover um tenant PARA esses status
// de saída — só o worker de Pagamento decide isso.
const TERMINAL_BY_PAYMENT = new Set(['past_due', 'canceled']);

export async function getTenant(tenantId) {
  const { rows } = await pool.query('SELECT * FROM tenants WHERE id = $1', [tenantId]);
  return rows[0] || null;
}

export async function getTenantByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM tenants WHERE email = $1', [email]);
  return rows[0] || null;
}

export async function createTenant({ name, email, passwordHash, plan }) {
  const { rows } = await pool.query(
    `INSERT INTO tenants (name, email, password_hash, plan, status)
     VALUES ($1, $2, $3, $4, 'pending_payment') RETURNING *`,
    [name, email, passwordHash, plan]
  );
  return rows[0];
}

/**
 * Transição de status com lock otimista. `source` identifica quem está pedindo
 * a mudança (payment | provisioning | connection | execution). Workers que não
 * são o de Pagamento nunca conseguem sobrescrever um status que o Pagamento já
 * moveu pra `past_due`/`canceled` — o UPDATE simplesmente não casa a condição.
 */
export async function transitionStatus(tenantId, { source, to, expectedVersion }) {
  const guard =
    source === 'payment'
      ? ''
      : `AND status NOT IN ('${[...TERMINAL_BY_PAYMENT].join("','")}')`;

  const { rows } = await pool.query(
    `UPDATE tenants
     SET status = $1, status_version = status_version + 1, updated_at = now()
     WHERE id = $2 AND status_version = $3 ${guard}
     RETURNING *`,
    [to, tenantId, expectedVersion]
  );

  if (rows.length === 0) {
    // Ou a versão mudou (outro worker já agiu) ou a guarda bloqueou (cancelamento
    // em vigor). Em ambos os casos, quem chamou deve reler o estado atual, não
    // insistir cegamente.
    return null;
  }

  await logEvent(tenantId, source, `status.${to}`, { from: expectedVersion, to });
  return rows[0];
}

export const DEFAULT_CONFIG_TEMPLATE = {
  surgeries: [
    {
      key: 'mamoplastia',
      name: 'Mamoplastia (aumento/redução/mastopexia)',
      required_exams: [
        'Hemograma completo',
        'Coagulograma (TAP/INR, TTPa)',
        'Glicemia de jejum',
        'ECG',
        'Mamografia OU USG de mamas com BIRADS',
        'Beta-HCG (mulheres em idade fértil)',
      ],
    },
    {
      key: 'abdominoplastia',
      name: 'Abdominoplastia',
      required_exams: [
        'Hemograma completo',
        'Coagulograma (TAP/INR, TTPa)',
        'Glicemia de jejum',
        'Ureia e Creatinina',
        'ECG',
        'RX de tórax',
        'Beta-HCG (mulheres em idade fértil)',
      ],
    },
    {
      key: 'lipoaspiracao',
      name: 'Lipoaspiração',
      required_exams: [
        'Hemograma completo',
        'Coagulograma (TAP/INR, TTPa)',
        'Glicemia de jejum',
        'ECG',
        'Beta-HCG (mulheres em idade fértil)',
      ],
    },
  ],
  exam_limits: [
    { exam_name: 'Hemoglobina (Hb)', description: 'Não liberar com Hb < 12 g/dL. Investigar anemia.', unit: 'g/dL', notes: 'Hb < 12 = pendência crítica.' },
    { exam_name: 'Plaquetas', description: 'Aceitável >= 150.000. Entre 100.000-150.000 avaliar. < 100.000 não liberar.', unit: '/mm³', notes: '' },
    { exam_name: 'INR', description: 'Aceitável <= 1,3 em paciente sem anticoagulante.', unit: '', notes: 'Investigar se elevado.' },
    { exam_name: 'Glicemia de jejum', description: 'Aceitável < 126 mg/dL. Valores elevados sugerem diabetes não controlado.', unit: 'mg/dL', notes: '' },
    { exam_name: 'Beta-HCG', description: 'Positivo contraindica cirurgia eletiva.', unit: '', notes: 'Positivo = pendência crítica.' },
  ],
};

export async function seedDefaultConfig(tenantId) {
  await pool.query(
    `INSERT INTO tenant_configs (tenant_id, surgeries, exam_limits, extra_prompt)
     VALUES ($1, $2, $3, '')
     ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId, JSON.stringify(DEFAULT_CONFIG_TEMPLATE.surgeries), JSON.stringify(DEFAULT_CONFIG_TEMPLATE.exam_limits)]
  );
}

const PLAN_LIMITS = { starter: 25, pro: 100, clinica: 400 };

export function planLimit(plan) {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.starter;
}
