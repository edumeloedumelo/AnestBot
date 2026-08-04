// Faturamento: importação versionada de terminologia (checksum), convênios,
// valores por porte em centavos, entradas com memória de cálculo imutável e
// eventos de pagamento (enviado/pago/glosado com motivo) append-only.
import crypto from 'node:crypto';
import { Router } from 'express';
import { getPool, withTx } from '../db.js';
import { appendAudit } from '../audit.js';
import { requireAuth, requireTeam, requirePermission } from '../auth.js';
import { calculate } from '../billing/calc.js';
import { compile, validateBody } from '../validate.js';

interface ImportBody { source_label: string; valid_from: string; codes: { code: string; description: string; port: string }[] }
const importSchema = compile<ImportBody>({
  type: 'object', additionalProperties: false,
  required: ['source_label', 'valid_from', 'codes'],
  properties: {
    source_label: { type: 'string', minLength: 2, maxLength: 200 },
    valid_from: { type: 'string', format: 'date' },
    codes: {
      type: 'array', minItems: 1, maxItems: 20000,
      items: {
        type: 'object', additionalProperties: false,
        required: ['code', 'description', 'port'],
        properties: {
          code: { type: 'string', minLength: 2, maxLength: 20 },
          description: { type: 'string', minLength: 2, maxLength: 300 },
          port: { type: 'string', pattern: '^[0-8][A-Ca-c]?$' },
        },
      },
    },
  },
});

interface InsurerBody { name: string }
const insurerSchema = compile<InsurerBody>({
  type: 'object', additionalProperties: false, required: ['name'],
  properties: { name: { type: 'string', minLength: 2, maxLength: 120 } },
});

interface PortPriceBody { port: string; price_cents: number; valid_from: string }
const portPriceSchema = compile<PortPriceBody>({
  type: 'object', additionalProperties: false, required: ['port', 'price_cents', 'valid_from'],
  properties: {
    port: { type: 'string', pattern: '^[0-8][A-Ca-c]?$' },
    price_cents: { type: 'integer', minimum: 0, maximum: 9007199254740991 },
    valid_from: { type: 'string', format: 'date' },
  },
});

interface EntryBody {
  insurer_id: string; case_id?: string; record_id?: string;
  codes: string[]; urgency_pct?: number; night_weekend_pct?: number;
}
const entrySchema = compile<EntryBody>({
  type: 'object', additionalProperties: false, required: ['insurer_id', 'codes'],
  properties: {
    insurer_id: { type: 'string', format: 'uuid' },
    case_id: { type: 'string', format: 'uuid' },
    record_id: { type: 'string', format: 'uuid' },
    codes: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 2, maxLength: 20 } },
    urgency_pct: { type: 'integer', minimum: 0, maximum: 300 },
    night_weekend_pct: { type: 'integer', minimum: 0, maximum: 300 },
  },
});

interface PaymentEventBody { kind: 'enviado' | 'pago' | 'glosado'; reason?: string; amount_cents?: number }
const paymentEventSchema = compile<PaymentEventBody>({
  type: 'object', additionalProperties: false, required: ['kind'],
  properties: {
    kind: { type: 'string', enum: ['enviado', 'pago', 'glosado'] },
    reason: { type: 'string', maxLength: 1000 },
    amount_cents: { type: 'integer', minimum: 0 },
  },
});

// Transições válidas do faturamento (glosado→enviado = recurso/reenvio).
const BILLING_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  a_faturar: new Set(['enviado']),
  enviado: new Set(['pago', 'glosado']),
  glosado: new Set(['enviado']),
  pago: new Set([]),
};

export function billingRouter(): Router {
  const r = Router();

  // ── terminologia (importação versionada — checksum do conteúdo) ───────────
  r.post('/teams/:teamId/procedure-imports', requireAuth, requireTeam, requirePermission('billing:write'),
    validateBody(importSchema), async (req, res) => {
      const body = req.body as ImportBody;
      // Checksum canônico do conteúdo: mesma base ⇒ mesmo checksum (auditável).
      const canonical = body.codes
        .map((c) => `${c.code}\t${c.description}\t${c.port}`)
        .sort()
        .join('\n');
      const checksum = crypto.createHash('sha256').update(canonical).digest('hex');
      const out = await withTx(async (tx) => {
        const importId = crypto.randomUUID();
        await tx.query(
          'INSERT INTO procedure_imports (id, team_id, source_label, checksum, valid_from, imported_by) VALUES ($1, $2, $3, $4, $5, $6)',
          [importId, req.team?.teamId, body.source_label.trim(), checksum, body.valid_from, req.user?.id],
        );
        for (const c of body.codes) {
          await tx.query(
            'INSERT INTO procedure_code_versions (id, team_id, import_id, code, description, port) VALUES ($1, $2, $3, $4, $5, $6)',
            [crypto.randomUUID(), req.team?.teamId, importId, c.code.trim(), c.description.trim(), c.port.toUpperCase()],
          );
        }
        await appendAudit(tx, {
          teamId: req.team?.teamId ?? null, userId: req.user?.id ?? null,
          action: 'billing.import_created', entityType: 'procedure_import', entityId: importId,
          meta: { codes: body.codes.length, checksum },
        });
        return importId;
      });
      res.status(201).json({ import_id: out, checksum, codes: body.codes.length });
    });

  r.get('/teams/:teamId/procedure-codes', requireAuth, requireTeam, requirePermission('billing:read'), async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    // Sempre a importação MAIS RECENTE da equipe (versões antigas permanecem
    // para reproduzir cálculos passados).
    const rows = await getPool().query(
      `SELECT v.id, v.code, v.description, v.port, i.source_label, i.checksum, i.valid_from
         FROM procedure_code_versions v
         JOIN procedure_imports i ON i.id = v.import_id
        WHERE v.team_id = $1
          AND i.id = (SELECT id FROM procedure_imports WHERE team_id = $1 ORDER BY created_at DESC LIMIT 1)
          AND ($2 = '' OR v.code ILIKE '%' || $2 || '%' OR v.description ILIKE '%' || $2 || '%')
        ORDER BY v.code LIMIT 100`,
      [req.team?.teamId, q],
    );
    res.json({ codes: rows.rows });
  });

  // ── convênios e preços de porte ───────────────────────────────────────────
  r.post('/teams/:teamId/insurers', requireAuth, requireTeam, requirePermission('billing:write'),
    validateBody(insurerSchema), async (req, res) => {
      try {
        const id = crypto.randomUUID();
        await getPool().query('INSERT INTO insurers (id, team_id, name) VALUES ($1, $2, $3)',
          [id, req.team?.teamId, (req.body as InsurerBody).name.trim()]);
        res.status(201).json({ insurer_id: id });
      } catch (e) {
        if ((e as { code?: string }).code === '23505') { res.status(409).json({ error: 'convênio já cadastrado' }); return; }
        throw e;
      }
    });

  r.post('/teams/:teamId/insurers/:insurerId/port-prices', requireAuth, requireTeam, requirePermission('billing:write'),
    validateBody(portPriceSchema), async (req, res) => {
      const body = req.body as PortPriceBody;
      const owns = await getPool().query('SELECT 1 FROM insurers WHERE team_id = $1 AND id = $2', [req.team?.teamId, req.params.insurerId]);
      if (!owns.rowCount) { res.sendStatus(404); return; }
      const id = crypto.randomUUID();
      await getPool().query(
        'INSERT INTO insurer_port_prices (id, team_id, insurer_id, port, price_cents, valid_from) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, req.team?.teamId, req.params.insurerId, body.port.toUpperCase(), body.price_cents, body.valid_from],
      );
      res.status(201).json({ price_id: id });
    });

  // ── entrada de faturamento (cálculo server-side, memória imutável) ────────
  r.post('/teams/:teamId/billing-entries', requireAuth, requireTeam, requirePermission('billing:write'),
    validateBody(entrySchema), async (req, res) => {
      const body = req.body as EntryBody;
      const teamId = String(req.team?.teamId);

      const insurer = await getPool().query('SELECT id, name FROM insurers WHERE team_id = $1 AND id = $2', [teamId, body.insurer_id]);
      if (!insurer.rowCount) { res.sendStatus(404); return; }
      if (body.case_id) {
        const c = await getPool().query('SELECT 1 FROM cases WHERE team_id = $1 AND id = $2', [teamId, body.case_id]);
        if (!c.rowCount) { res.sendStatus(404); return; }
      }
      if (body.record_id) {
        const rr = await getPool().query('SELECT 1 FROM anesthesia_records WHERE team_id = $1 AND id = $2', [teamId, body.record_id]);
        if (!rr.rowCount) { res.sendStatus(404); return; }
      }

      // Resolve códigos na importação MAIS RECENTE e preços de porte do
      // convênio — o cliente NUNCA envia valores.
      const latestImport = await getPool().query(
        'SELECT id, checksum FROM procedure_imports WHERE team_id = $1 ORDER BY created_at DESC LIMIT 1', [teamId],
      );
      if (!latestImport.rowCount) { res.status(409).json({ error: 'nenhuma terminologia importada — importe sua base autorizada primeiro' }); return; }
      const imp = latestImport.rows[0] as { id: string; checksum: string };

      const versions = await getPool().query(
        'SELECT id, code, description, port FROM procedure_code_versions WHERE import_id = $1 AND code = ANY($2)',
        [imp.id, body.codes],
      );
      const byCode = new Map<string, { id: string; code: string; description: string; port: string }>();
      for (const row of versions.rows as { id: string; code: string; description: string; port: string }[]) byCode.set(row.code, row);
      const missing = body.codes.filter((c) => !byCode.has(c));
      if (missing.length) { res.status(422).json({ error: `código(s) fora da terminologia importada: ${missing.join(', ')}` }); return; }

      const procs: { code: string; description: string; port: string; base_cents: number; version_id: string }[] = [];
      for (const code of body.codes) {
        const v = byCode.get(code);
        if (!v) continue;
        const price = await getPool().query(
          `SELECT price_cents FROM insurer_port_prices
            WHERE insurer_id = $1 AND port = $2 AND valid_from <= CURRENT_DATE
            ORDER BY valid_from DESC LIMIT 1`,
          [body.insurer_id, v.port],
        );
        if (!price.rowCount) { res.status(422).json({ error: `convênio sem valor vigente para o porte ${v.port}` }); return; }
        procs.push({
          code: v.code, description: v.description, port: v.port,
          base_cents: Number((price.rows[0] as { price_cents: string | number }).price_cents),
          version_id: v.id,
        });
      }

      const calcInput = {
        procedures: procs.map(({ code, description, port, base_cents }) => ({ code, description, port, base_cents })),
        ...(body.urgency_pct !== undefined ? { urgency_pct: body.urgency_pct } : {}),
        ...(body.night_weekend_pct !== undefined ? { night_weekend_pct: body.night_weekend_pct } : {}),
      };
      const result = calculate(calcInput);

      const out = await withTx(async (tx) => {
        const entryId = crypto.randomUUID();
        // Memória completa: input + resultado + versão da terminologia usada.
        const calcRecord = {
          input: calcInput, result,
          terminology: { import_id: imp.id, checksum: imp.checksum },
          insurer: { id: body.insurer_id, name: (insurer.rows[0] as { name: string }).name },
        };
        await tx.query(
          `INSERT INTO billing_entries (id, team_id, case_id, record_id, insurer_id, status, total_cents, calc, created_by)
           VALUES ($1, $2, $3, $4, $5, 'a_faturar', $6, $7, $8)`,
          [entryId, teamId, body.case_id ?? null, body.record_id ?? null, body.insurer_id, result.total_cents, JSON.stringify(calcRecord), req.user?.id],
        );
        for (const item of result.items) {
          const version = procs.find((p) => p.code === item.code);
          await tx.query(
            `INSERT INTO billing_entry_items (id, team_id, entry_id, code_version_id, position, port, base_cents, applied_pct, amount_cents)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [crypto.randomUUID(), teamId, entryId, version?.version_id, item.position, item.port, item.base_cents, item.applied_pct, item.amount_cents],
          );
        }
        await appendAudit(tx, {
          teamId, userId: req.user?.id ?? null,
          action: 'billing.entry_created', entityType: 'billing_entry', entityId: entryId,
          meta: { total_cents: result.total_cents, codes: body.codes.length },
        });
        return entryId;
      });
      res.status(201).json({ entry_id: out, total_cents: result.total_cents, memory: result.memory });
    });

  r.get('/teams/:teamId/billing-entries', requireAuth, requireTeam, requirePermission('billing:read'), async (req, res) => {
    const status = String(req.query.status ?? '').trim();
    const rows = await getPool().query(
      `SELECT id, case_id, record_id, insurer_id, status, total_cents, created_at, updated_at
         FROM billing_entries WHERE team_id = $1 AND ($2 = '' OR status = $2)
        ORDER BY created_at DESC LIMIT 200`,
      [req.team?.teamId, status],
    );
    res.json({ entries: rows.rows });
  });

  r.get('/teams/:teamId/billing-entries/:entryId', requireAuth, requireTeam, requirePermission('billing:read'), async (req, res) => {
    const q = await getPool().query('SELECT * FROM billing_entries WHERE team_id = $1 AND id = $2', [req.team?.teamId, req.params.entryId]);
    if (!q.rowCount) { res.sendStatus(404); return; }
    const items = await getPool().query('SELECT position, port, base_cents, applied_pct, amount_cents FROM billing_entry_items WHERE entry_id = $1 ORDER BY position', [req.params.entryId]);
    const events = await getPool().query('SELECT kind, amount_cents, reason, occurred_at FROM payment_events WHERE entry_id = $1 ORDER BY occurred_at', [req.params.entryId]);
    res.json({ entry: q.rows[0], items: items.rows, events: events.rows });
  });

  // Evento de pagamento move o status (máquina validada; glosa exige motivo).
  r.post('/teams/:teamId/billing-entries/:entryId/events', requireAuth, requireTeam, requirePermission('billing:write'),
    validateBody(paymentEventSchema), async (req, res) => {
      const body = req.body as PaymentEventBody;
      if (body.kind === 'glosado' && !body.reason?.trim()) {
        res.status(400).json({ error: 'glosa exige motivo' });
        return;
      }
      const out = await withTx(async (tx) => {
        const cur = await tx.query('SELECT status FROM billing_entries WHERE team_id = $1 AND id = $2 FOR UPDATE', [req.team?.teamId, req.params.entryId]);
        if (!cur.rowCount) return { code: 404 as const, body: {} };
        const from = (cur.rows[0] as { status: string }).status;
        if (!BILLING_TRANSITIONS[from]?.has(body.kind)) {
          return { code: 409 as const, body: { error: `transição inválida: ${from} → ${body.kind}` } };
        }
        await tx.query(
          'INSERT INTO payment_events (id, team_id, entry_id, kind, amount_cents, reason, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [crypto.randomUUID(), req.team?.teamId, req.params.entryId, body.kind, body.amount_cents ?? null, body.reason?.trim() ?? '', req.user?.id],
        );
        await tx.query('UPDATE billing_entries SET status = $1, updated_at = now() WHERE id = $2', [body.kind, req.params.entryId]);
        await appendAudit(tx, {
          teamId: req.team?.teamId ?? null, userId: req.user?.id ?? null,
          action: 'billing.status_changed', entityType: 'billing_entry', entityId: String(req.params.entryId),
          meta: { from, to: body.kind },
        });
        return { code: 201 as const, body: { ok: true, status: body.kind } };
      });
      res.status(out.code).json(out.body);
    });

  // Relatório por status e por convênio (centavos somados no banco).
  r.get('/teams/:teamId/billing-report', requireAuth, requireTeam, requirePermission('billing:read'), async (req, res) => {
    const days = Math.min(365, Math.max(1, parseInt(String(req.query.days ?? '30'), 10) || 30));
    const byStatus = await getPool().query(
      `SELECT status, count(*)::int AS n, coalesce(sum(total_cents), 0)::bigint AS total_cents
         FROM billing_entries WHERE team_id = $1 AND created_at > now() - make_interval(days => $2)
        GROUP BY status`,
      [req.team?.teamId, days],
    );
    const byInsurer = await getPool().query(
      `SELECT i.name, b.status, count(*)::int AS n, coalesce(sum(b.total_cents), 0)::bigint AS total_cents
         FROM billing_entries b JOIN insurers i ON i.id = b.insurer_id
        WHERE b.team_id = $1 AND b.created_at > now() - make_interval(days => $2)
        GROUP BY i.name, b.status ORDER BY i.name`,
      [req.team?.teamId, days],
    );
    res.json({ period_days: days, by_status: byStatus.rows, by_insurer: byInsurer.rows });
  });

  return r;
}
