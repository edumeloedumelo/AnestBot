// Seed SINTÉTICO de demonstração — NUNCA usar dados reais de pacientes.
// Recusa rodar se já houver usuários (proteção contra rodar em banco vivo).
import 'dotenv/config';
import crypto from 'node:crypto';
import { getPool, closePool, withTx } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { hashPassword } from '../src/crypto.js';

const DEMO_PASSWORD = 'demo-anestbot-2026';

async function main(): Promise<void> {
  await runMigrations();
  const existing = await getPool().query('SELECT count(*)::int AS n FROM users');
  if ((existing.rows[0] as { n: number }).n > 0) {
    throw new Error('banco já possui usuários — seed de demonstração só roda em banco vazio');
  }

  await withTx(async (tx) => {
    const teamId = crypto.randomUUID();
    await tx.query(`INSERT INTO teams (id, name, plan, trial_ends_at) VALUES ($1, 'Equipe Demonstração (SINTÉTICA)', 'trial', now() + interval '14 days')`, [teamId]);

    const mk = async (email: string, name: string, role: string, crm: string | null) => {
      const id = crypto.randomUUID();
      await tx.query('INSERT INTO users (id, email, password_hash, full_name, crm) VALUES ($1, $2, $3, $4, $5)',
        [id, email, await hashPassword(DEMO_PASSWORD), name, crm]);
      await tx.query('INSERT INTO memberships (id, team_id, user_id, role) VALUES ($1, $2, $3, $4)',
        [crypto.randomUUID(), teamId, id, role]);
      return id;
    };
    const owner = await mk('demo.owner@example.com', 'Dra. Demo Fictícia', 'owner', 'CRM-DEMO-0001');
    await mk('demo.secretaria@example.com', 'Secretária Demo Fictícia', 'secretary', null);
    await mk('demo.leitura@example.com', 'Leitura Demo Fictícia', 'viewer', null);

    await tx.query('INSERT INTO whatsapp_links (id, team_id, chat_ref, label, created_by) VALUES ($1, $2, $3, $4, $5)',
      [crypto.randomUUID(), teamId, 'demo-grupo@g.us', 'Grupo demo (sintético)', owner]);

    // Pacientes e casos claramente sintéticos.
    for (let i = 1; i <= 5; i++) {
      const patientId = crypto.randomUUID();
      await tx.query('INSERT INTO patients (id, team_id, full_name, insurer) VALUES ($1, $2, $3, $4)',
        [patientId, teamId, `Paciente Sintética ${i}`, i % 2 ? 'Convênio Demo' : 'Particular']);
      const caseId = crypto.randomUUID();
      const status = i <= 3 ? 'analyzed' : 'received';
      await tx.query(
        `INSERT INTO cases (id, team_id, patient_id, chat_ref, correlation_id, status, surgery, received_at)
         VALUES ($1, $2, $3, 'demo-grupo@g.us', $4, $5, $6, now() - make_interval(days => $7))`,
        [caseId, teamId, patientId, `demo-corr-${i}`, status, i % 2 ? 'Mamoplastia (demo)' : 'Lipoaspiração (demo)', i],
      );
      if (status === 'analyzed') {
        await tx.query(
          `INSERT INTO case_analyses (id, team_id, case_id, seq, patient_name, surgery, anamnesis, report_text, model, prompt_rev, occurred_at)
           VALUES ($1, $2, $3, 1, $4, $5, $6, $7, 'demo', 'demo', now() - make_interval(days => $8))`,
          [crypto.randomUUID(), teamId, caseId, `Paciente Sintética ${i}`, 'Demo',
           'Anamnese SINTÉTICA para demonstração — não é dado real.',
           '🧾 *AVALIAÇÃO PRÉ-ANESTÉSICA*\n━━━\nDados sintéticos de demonstração.', i],
        );
      }
    }
  });
  console.log(JSON.stringify({ msg: 'seed sintético aplicado', login: 'demo.owner@example.com', password: DEMO_PASSWORD }));
}

main().then(() => closePool()).catch((e) => { console.error((e as Error).message); process.exit(1); });
