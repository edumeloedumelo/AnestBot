// Marco 4 — faturamento: cálculo determinístico em centavos, arredondamento
// (cenário 13), terminologia versionada com checksum, máquina de estados com
// glosa e trilha append-only. Postgres REAL via testdb.sh.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';

process.env.PLATFORM_EVENTS_SECRET ??= 'test-secret-primary';

const { runMigrations } = await import('../src/migrate.js');
const { createApp } = await import('../src/app.js');
const { getPool, closePool } = await import('../src/db.js');
const { calculate, roundHalfUpCents } = await import('../src/billing/calc.js');

let server: Server;
let baseUrl = '';
let ipc = 0;

interface HttpResult { status: number; json: Record<string, unknown> }
async function http(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<HttpResult> {
  const headers: Record<string, string> = { 'X-Forwarded-For': `10.7.${Math.floor(ipc / 250)}.${(ipc++ % 250) + 1}` };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers['Content-Type'] = 'application/json'; }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, ...(body !== undefined ? { body } : {}) });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { json = {}; }
  return { status: res.status, json };
}

const S = { token: '', team: '', secToken: '', viewerToken: '', insurer: '', entry: '' };

before(async () => {
  await runMigrations();
  const app = createApp();
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  const addr = server.address();
  if (addr && typeof addr === 'object') baseUrl = `http://127.0.0.1:${addr.port}`;

  const reg = await http('POST', '/api/auth/register', { body: { email: 'fat.dra@example.com', password: 'senha-fatura-0001', full_name: 'Dra. Fatura Sintética', team_name: 'Equipe Fatura', crm: 'CRM-MG-55555' } });
  S.team = reg.json.team_id as string;
  S.token = (await http('POST', '/api/auth/login', { body: { email: 'fat.dra@example.com', password: 'senha-fatura-0001' } })).json.token as string;

  const invS = await http('POST', `/api/teams/${S.team}/invites`, { token: S.token, body: { email: 'fat.sec@example.com', role: 'secretary' } });
  await http('POST', '/api/invites/accept', { body: { token: invS.json.token, password: 'senha-fatura-0002', full_name: 'Sec Fatura' } });
  S.secToken = (await http('POST', '/api/auth/login', { body: { email: 'fat.sec@example.com', password: 'senha-fatura-0002' } })).json.token as string;

  const invV = await http('POST', `/api/teams/${S.team}/invites`, { token: S.token, body: { email: 'fat.view@example.com', role: 'viewer' } });
  await http('POST', '/api/invites/accept', { body: { token: invV.json.token, password: 'senha-fatura-0003', full_name: 'View Fatura' } });
  S.viewerToken = (await http('POST', '/api/auth/login', { body: { email: 'fat.view@example.com', password: 'senha-fatura-0003' } })).json.token as string;
});
after(async () => { server?.close(); await closePool(); });

// ── calculadora pura (cenário 13: arredondamento e centavos) ────────────────
test('roundHalfUpCents: casos exatos de meio centavo e inteiros seguros', () => {
  assert.equal(roundHalfUpCents(10001 * 70, 100), 7001);   // 7000,7 → 7001
  assert.equal(roundHalfUpCents(10001 * 50, 100), 5001);   // 5000,5 → 5001 (half-UP)
  assert.equal(roundHalfUpCents(10000 * 70, 100), 7000);   // exato
  assert.equal(roundHalfUpCents(1 * 33, 100), 0);          // 0,33 → 0
  assert.equal(roundHalfUpCents(2 * 33, 100), 1);          // 0,66 → 1
  assert.throws(() => roundHalfUpCents(0.5 as never, 100), /inteiros/);
});

test('calculate: múltiplos 100/70/50 ordenados por valor, total em centavos exatos', () => {
  const r = calculate({
    procedures: [
      { code: 'B', description: 'menor', port: '3', base_cents: 10001 },
      { code: 'A', description: 'maior', port: '6', base_cents: 50000 },
      { code: 'C', description: 'médio', port: '4', base_cents: 20000 },
      { code: 'D', description: 'quarto', port: '2', base_cents: 8000 },
    ],
  });
  // Ordenado: A(50000×100%)=50000, C(20000×70%)=14000, B(10001×50%)=5001, D(8000×50%)=4000
  assert.deepEqual(r.items.map((i) => [i.code, i.applied_pct, i.amount_cents]), [
    ['A', 100, 50000], ['C', 70, 14000], ['B', 50, 5001], ['D', 50, 4000],
  ]);
  assert.equal(r.subtotal_cents, 73001);
  assert.equal(r.total_cents, 73001);
});

test('calculate: urgência 30% + noturno 20% sobre o subtotal, half-up, memória reproduzível', () => {
  const input = {
    procedures: [{ code: 'X', description: 'x', port: '5', base_cents: 33333 }],
    urgency_pct: 30, night_weekend_pct: 20,
  };
  const r1 = calculate(input);
  // subtotal 33333; urgência 30% = 9999,9 → 10000; noturno 20% = 6666,6 → 6667
  assert.equal(r1.subtotal_cents, 33333);
  assert.deepEqual(r1.surcharges.map((s) => s.amount_cents), [10000, 6667]);
  assert.equal(r1.total_cents, 33333 + 10000 + 6667);
  const r2 = calculate(input);
  assert.deepEqual(r1, r2, 'mesmo input ⇒ EXATAMENTE o mesmo output (reproduzível)');
});

test('calculate: empate de valor desempata por código (determinismo)', () => {
  const a = calculate({ procedures: [
    { code: 'ZZZ', description: 'z', port: '3', base_cents: 1000 },
    { code: 'AAA', description: 'a', port: '3', base_cents: 1000 },
  ] });
  assert.deepEqual(a.items.map((i) => i.code), ['AAA', 'ZZZ']);
});

// ── terminologia versionada ─────────────────────────────────────────────────
test('importação: checksum determinístico; reimportar = nova versão, mesmo checksum', async () => {
  const codes = [
    { code: '31602029', description: 'Procedimento sintético 1', port: '4' },
    { code: '31602100', description: 'Procedimento sintético 2', port: '6' },
    { code: '31602200', description: 'Procedimento sintético 3', port: '3' },
  ];
  const i1 = await http('POST', `/api/teams/${S.team}/procedure-imports`, { token: S.token, body: { source_label: 'Base autorizada demo v1', valid_from: '2026-01-01', codes } });
  assert.equal(i1.status, 201);
  const i2 = await http('POST', `/api/teams/${S.team}/procedure-imports`, { token: S.token, body: { source_label: 'Base autorizada demo v1 (reimport)', valid_from: '2026-02-01', codes } });
  assert.equal(i2.status, 201);
  assert.equal(i1.json.checksum, i2.json.checksum, 'mesmo conteúdo ⇒ mesmo checksum');
  assert.notEqual(i1.json.import_id, i2.json.import_id, 'importações são versões distintas');

  const search = await http('GET', `/api/teams/${S.team}/procedure-codes?q=sintético`, { token: S.token });
  assert.equal((search.json.codes as unknown[]).length, 3);
});

test('porte inválido no import é rejeitado por schema (400)', async () => {
  const bad = await http('POST', `/api/teams/${S.team}/procedure-imports`, {
    token: S.token,
    body: { source_label: 'x2', valid_from: '2026-01-01', codes: [{ code: '123456', description: 'porte impossível', port: '9' }] },
  });
  assert.equal(bad.status, 400);
});

// ── convênios, preços e entrada ─────────────────────────────────────────────
test('entrada de faturamento: valores SEMPRE do banco, memória gravada, itens imutáveis', async () => {
  const ins = await http('POST', `/api/teams/${S.team}/insurers`, { token: S.token, body: { name: 'Convênio Demo' } });
  S.insurer = ins.json.insurer_id as string;
  for (const [port, cents] of [['4', 40000], ['6', 90000], ['3', 30000]] as const) {
    const p = await http('POST', `/api/teams/${S.team}/insurers/${S.insurer}/port-prices`, { token: S.token, body: { port, price_cents: cents, valid_from: '2026-01-01' } });
    assert.equal(p.status, 201);
  }

  const entry = await http('POST', `/api/teams/${S.team}/billing-entries`, {
    token: S.secToken, // secretaria OPERA o faturamento
    body: { insurer_id: S.insurer, codes: ['31602100', '31602029', '31602200'], urgency_pct: 30 },
  });
  assert.equal(entry.status, 201);
  S.entry = entry.json.entry_id as string;
  // 90000×100% + 40000×70%(=28000) + 30000×50%(=15000) = 133000; urgência 30% = 39900 → 172900
  assert.equal(entry.json.total_cents, 172900);

  const detail = await http('GET', `/api/teams/${S.team}/billing-entries/${S.entry}`, { token: S.secToken });
  const calc = (detail.json.entry as { calc: { terminology: { checksum: string }; result: { total_cents: number } } }).calc;
  assert.match(calc.terminology.checksum, /^[0-9a-f]{64}$/, 'memória referencia a versão exata da terminologia');
  assert.equal(calc.result.total_cents, 172900);

  await assert.rejects(getPool().query('UPDATE billing_entry_items SET amount_cents = 1 WHERE entry_id = $1', [S.entry]), /append-only/);
  await assert.rejects(getPool().query(`UPDATE billing_entries SET total_cents = 1 WHERE id = $1`, [S.entry]), /imutável/);
});

test('código fora da terminologia (422) e porte sem preço no convênio (422)', async () => {
  const unknown = await http('POST', `/api/teams/${S.team}/billing-entries`, { token: S.token, body: { insurer_id: S.insurer, codes: ['99999999'] } });
  assert.equal(unknown.status, 422);

  const noPrice = await http('POST', `/api/teams/${S.team}/procedure-imports`, {
    token: S.token,
    body: { source_label: 'com porte 8', valid_from: '2026-03-01', codes: [
      { code: '31602029', description: 'Procedimento sintético 1', port: '4' },
      { code: '31602100', description: 'Procedimento sintético 2', port: '6' },
      { code: '31602200', description: 'Procedimento sintético 3', port: '3' },
      { code: '88888888', description: 'Porte sem preço', port: '8' },
    ] },
  });
  assert.equal(noPrice.status, 201);
  const r = await http('POST', `/api/teams/${S.team}/billing-entries`, { token: S.token, body: { insurer_id: S.insurer, codes: ['88888888'] } });
  assert.equal(r.status, 422);
  assert.match(String(r.json.error), /porte 8/);
});

// ── máquina de estados do faturamento ───────────────────────────────────────
test('estados: a_faturar→pago é inválido; glosa exige motivo; glosado→enviado (recurso) ok', async () => {
  const direct = await http('POST', `/api/teams/${S.team}/billing-entries/${S.entry}/events`, { token: S.secToken, body: { kind: 'pago' } });
  assert.equal(direct.status, 409, 'não se paga o que não foi enviado');

  assert.equal((await http('POST', `/api/teams/${S.team}/billing-entries/${S.entry}/events`, { token: S.secToken, body: { kind: 'enviado' } })).status, 201);

  const noReason = await http('POST', `/api/teams/${S.team}/billing-entries/${S.entry}/events`, { token: S.secToken, body: { kind: 'glosado' } });
  assert.equal(noReason.status, 400, 'glosa sem motivo é rejeitada');

  assert.equal((await http('POST', `/api/teams/${S.team}/billing-entries/${S.entry}/events`, { token: S.secToken, body: { kind: 'glosado', reason: 'Código não coberto pelo contrato (sintético)' } })).status, 201);
  assert.equal((await http('POST', `/api/teams/${S.team}/billing-entries/${S.entry}/events`, { token: S.secToken, body: { kind: 'enviado' } })).status, 201, 'recurso após glosa');
  assert.equal((await http('POST', `/api/teams/${S.team}/billing-entries/${S.entry}/events`, { token: S.secToken, body: { kind: 'pago', amount_cents: 172900 } })).status, 201);
  assert.equal((await http('POST', `/api/teams/${S.team}/billing-entries/${S.entry}/events`, { token: S.secToken, body: { kind: 'enviado' } })).status, 409, 'pago é terminal');

  await assert.rejects(getPool().query('DELETE FROM payment_events'), /append-only/, 'trilha de pagamento nunca é apagada');
});

// ── RBAC e relatório ────────────────────────────────────────────────────────
test('RBAC: viewer não acessa faturamento; secretaria sim (operacional)', async () => {
  assert.equal((await http('GET', `/api/teams/${S.team}/billing-entries`, { token: S.viewerToken })).status, 403);
  assert.equal((await http('GET', `/api/teams/${S.team}/billing-entries`, { token: S.secToken })).status, 200);
});

test('relatório: soma por status/convênio em centavos e histórico completo no detalhe', async () => {
  const rep = await http('GET', `/api/teams/${S.team}/billing-report`, { token: S.token });
  assert.equal(rep.status, 200);
  const byStatus = rep.json.by_status as { status: string; n: number; total_cents: string }[];
  const pago = byStatus.find((s) => s.status === 'pago');
  assert.ok(pago, 'entrada paga aparece no relatório');
  assert.equal(Number(pago?.total_cents), 172900);

  const detail = await http('GET', `/api/teams/${S.team}/billing-entries/${S.entry}`, { token: S.token });
  const events = detail.json.events as { kind: string; reason: string }[];
  assert.deepEqual(events.map((e) => e.kind), ['enviado', 'glosado', 'enviado', 'pago'], 'trilha completa preservada');
  assert.ok(events[1]?.reason.includes('não coberto'), 'motivo da glosa registrado');
});
