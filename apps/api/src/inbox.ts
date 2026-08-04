// INBOX de eventos do bot (contrato: packages/contracts).
//
// Pipeline fail-closed: tamanho (413 via limite do parser) → assinatura HMAC
// (primário OU anterior — rotação) → janela de timestamp (300s, anti-replay)
// → schema do envelope → pareamento chat_ref→tenant (409 sem pareamento; o
// outbox do bot manda para a dead-letter e o admin dá replay após parear) →
// dedup por event_id (duplicata = 200 sem reprocessar) → processamento na
// MESMA transação do recibo.
//
// Logs estruturados SEM payload (o payload contém dados clínicos).
import crypto from 'node:crypto';
import { Router, raw, type Request, type Response } from 'express';
import { withTx } from './db.js';
import { verifyEventSignature } from './crypto.js';
import { envelopeSchema, type EventEnvelope } from './validate.js';
import type pg from 'pg';

const TIMESTAMP_WINDOW_S = 300;
export const EVENT_BODY_LIMIT = '1mb';

export function eventSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.PLATFORM_EVENTS_SECRET || '', env.PLATFORM_EVENTS_SECRET_PREVIOUS || ''].filter(Boolean);
}

export function timestampFresh(tsHeader: string, nowMs: number = Date.now()): boolean {
  if (!/^\d{9,12}$/.test(tsHeader)) return false;
  const ts = parseInt(tsHeader, 10);
  return Math.abs(Math.floor(nowMs / 1000) - ts) <= TIMESTAMP_WINDOW_S;
}

async function resolveTeam(tx: pg.PoolClient, chatRef: string): Promise<string | null> {
  const q = await tx.query('SELECT team_id FROM whatsapp_links WHERE chat_ref = $1', [chatRef]);
  return q.rowCount ? (q.rows[0] as { team_id: string }).team_id : null;
}

// ── handlers por tipo de evento (rodam DENTRO da transação do recibo) ────────
async function handleCaseReceived(tx: pg.PoolClient, teamId: string, ev: EventEnvelope): Promise<void> {
  const receivedAt = typeof ev.payload.closed_at === 'string' ? ev.payload.closed_at : ev.occurred_at;
  await tx.query(
    `INSERT INTO cases (id, team_id, chat_ref, correlation_id, status, received_at)
     VALUES ($1, $2, $3, $4, 'received', $5)
     ON CONFLICT (team_id, correlation_id) WHERE correlation_id <> '' DO NOTHING`,
    [crypto.randomUUID(), teamId, ev.chat_ref, ev.correlation_id, receivedAt],
  );
}

async function findOrCreateCase(tx: pg.PoolClient, teamId: string, ev: EventEnvelope): Promise<string> {
  const found = await tx.query(
    'SELECT id FROM cases WHERE team_id = $1 AND correlation_id = $2', [teamId, ev.correlation_id],
  );
  if (found.rowCount) return (found.rows[0] as { id: string }).id;
  const id = crypto.randomUUID();
  await tx.query(
    `INSERT INTO cases (id, team_id, chat_ref, correlation_id, status, received_at)
     VALUES ($1, $2, $3, $4, 'received', $5)`,
    [id, teamId, ev.chat_ref, ev.correlation_id, ev.occurred_at],
  );
  return id;
}

// Transições VÁLIDAS da máquina de estados (nunca regride um caso revisado).
const TRANSITIONS: Record<string, ReadonlySet<string>> = {
  received: new Set(['analyzing', 'analyzed', 'analysis_failed']),
  analyzing: new Set(['analyzed', 'analysis_failed']),
  analyzed: new Set(['analyzing', 'reviewed']),          // reanálise permitida
  analysis_failed: new Set(['analyzing', 'analyzed']),
  reviewed: new Set([]),                                  // terminal (nova revisão não muda status)
};

export async function setCaseStatus(tx: pg.PoolClient, caseId: string, to: string): Promise<boolean> {
  const cur = await tx.query('SELECT status FROM cases WHERE id = $1 FOR UPDATE', [caseId]);
  if (!cur.rowCount) return false;
  const from = (cur.rows[0] as { status: string }).status;
  if (from === to) return true;
  if (!TRANSITIONS[from]?.has(to)) return false; // transição inválida é ignorada com log (nunca corrompe)
  await tx.query('UPDATE cases SET status = $1 WHERE id = $2', [to, caseId]);
  return true;
}

async function handleAnalysisStarted(tx: pg.PoolClient, teamId: string, ev: EventEnvelope): Promise<void> {
  const caseId = await findOrCreateCase(tx, teamId, ev);
  const ok = await setCaseStatus(tx, caseId, 'analyzing');
  if (!ok) console.error(JSON.stringify({ level: 'warn', msg: 'transição de status ignorada', case_id: caseId, to: 'analyzing' }));
}

async function handleAnalysisCompleted(tx: pg.PoolClient, teamId: string, ev: EventEnvelope): Promise<void> {
  const caseId = await findOrCreateCase(tx, teamId, ev);
  const p = ev.payload as {
    patient_name?: string; surgery?: string; anamnesis?: string; report_text?: string;
    files?: object; errors?: unknown[]; analysis?: { model?: string; prompt_rev?: string };
  };

  // Paciente: associação ASSISTIDA — reusa homônimo exato do MESMO tenant,
  // senão cria. Nunca funde registros (fusão automática é proibida).
  let patientId: string | null = null;
  const name = (p.patient_name ?? '').trim();
  if (name && !/^Caso \d+$/.test(name)) {
    const existing = await tx.query(
      'SELECT id FROM patients WHERE team_id = $1 AND lower(full_name) = lower($2) ORDER BY created_at LIMIT 1',
      [teamId, name],
    );
    if (existing.rowCount) patientId = (existing.rows[0] as { id: string }).id;
    else {
      patientId = crypto.randomUUID();
      await tx.query('INSERT INTO patients (id, team_id, full_name) VALUES ($1, $2, $3)', [patientId, teamId, name]);
    }
  }

  // Análise IMUTÁVEL e versionada (reanálise = seq+1); dedup do inbox garante
  // que o MESMO evento nunca gera duas análises.
  const seqQ = await tx.query('SELECT coalesce(max(seq), 0) + 1 AS next FROM case_analyses WHERE case_id = $1', [caseId]);
  const seq = (seqQ.rows[0] as { next: number }).next;
  await tx.query(
    `INSERT INTO case_analyses (id, team_id, case_id, seq, patient_name, surgery, anamnesis, report_text, files, errors, model, prompt_rev, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      crypto.randomUUID(), teamId, caseId, seq, name, p.surgery ?? '', p.anamnesis ?? '', p.report_text ?? '',
      JSON.stringify(p.files ?? {}), JSON.stringify(p.errors ?? []),
      p.analysis?.model ?? '', p.analysis?.prompt_rev ?? '', ev.occurred_at,
    ],
  );
  await tx.query(
    'UPDATE cases SET patient_id = coalesce($1, patient_id), surgery = CASE WHEN $2 <> \'\' THEN $2 ELSE surgery END WHERE id = $3',
    [patientId, p.surgery ?? '', caseId],
  );
  await setCaseStatus(tx, caseId, 'analyzed');
}

async function handleAnalysisFailed(tx: pg.PoolClient, teamId: string, ev: EventEnvelope): Promise<void> {
  const caseId = await findOrCreateCase(tx, teamId, ev);
  await setCaseStatus(tx, caseId, 'analysis_failed');
}

const HANDLERS: Record<string, (tx: pg.PoolClient, teamId: string, ev: EventEnvelope) => Promise<void>> = {
  'case.received.v1': handleCaseReceived,
  'case.analysis_started.v1': handleAnalysisStarted,
  'case.analysis_completed.v1': handleAnalysisCompleted,
  'case.analysis_failed.v1': handleAnalysisFailed,
};

// ── rota ────────────────────────────────────────────────────────────────────
export function inboxRouter(): Router {
  const r = Router();
  // raw: a assinatura cobre o CORPO BRUTO — parse só depois de verificar.
  r.post('/internal/events', raw({ type: 'application/json', limit: EVENT_BODY_LIMIT }), async (req: Request, res: Response) => {
    const secrets = eventSecrets();
    if (secrets.length === 0) { res.sendStatus(503); return; } // sem segredo configurado: fechado

    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf-8') : '';
    const ts = String(req.headers['x-anestbot-timestamp'] ?? '');
    const sig = String(req.headers['x-anestbot-signature'] ?? '');

    if (!verifyEventSignature(rawBody, ts, sig, secrets)) {
      console.error(JSON.stringify({ level: 'warn', msg: 'evento com assinatura inválida' }));
      res.status(401).json({ error: 'assinatura inválida' });
      return;
    }
    if (!timestampFresh(ts)) {
      console.error(JSON.stringify({ level: 'warn', msg: 'evento fora da janela de timestamp' }));
      res.status(401).json({ error: 'timestamp fora da janela' });
      return;
    }

    let envelope: EventEnvelope;
    try { envelope = JSON.parse(rawBody) as EventEnvelope; }
    catch { res.status(400).json({ error: 'JSON inválido' }); return; }
    if (!envelopeSchema(envelope)) { res.status(400).json({ error: 'envelope fora do contrato' }); return; }

    try {
      const outcome = await withTx(async (tx) => {
        const teamId = await resolveTeam(tx, envelope.chat_ref);
        if (!teamId) return { code: 409 as const, body: { error: 'chat não pareado a nenhuma equipe' } };

        // Idempotência: INSERT do recibo; conflito ⇒ evento já processado.
        const receipt = await tx.query(
          `INSERT INTO inbox_receipts (id, event_id, event_type, source, team_id, chat_ref)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (event_id) DO NOTHING`,
          [crypto.randomUUID(), envelope.event_id, envelope.event_type, envelope.source, teamId, envelope.chat_ref],
        );
        if (receipt.rowCount === 0) return { code: 200 as const, body: { ok: true, duplicate: true } };

        const handler = HANDLERS[envelope.event_type];
        if (handler) await handler(tx, teamId, envelope);
        // Tipo desconhecido: recibo gravado (não reprocessa), sem efeito — forward-compat.
        return { code: 200 as const, body: { ok: true } };
      });
      console.error(JSON.stringify({ level: 'info', msg: 'evento processado', event_type: envelope.event_type, event_id: envelope.event_id, code: outcome.code }));
      res.status(outcome.code).json(outcome.body);
    } catch (e) {
      console.error(JSON.stringify({ level: 'error', msg: 'falha ao processar evento', event_id: envelope.event_id, error: (e as Error).message }));
      res.status(500).json({ error: 'falha interna ao processar' }); // bot fará retry
    }
  });
  return r;
}
