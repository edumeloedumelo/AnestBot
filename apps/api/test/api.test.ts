// Suíte de integração da API — roda contra PostgreSQL REAL efêmero
// (scripts/testdb.sh). Todos os dados são SINTÉTICOS.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Server } from 'node:http';

process.env.PLATFORM_EVENTS_SECRET = 'test-secret-primary';
process.env.PLATFORM_EVENTS_SECRET_PREVIOUS = 'test-secret-old';

const { runMigrations } = await import('../src/migrate.js');
const { createApp } = await import('../src/app.js');
const { getPool, closePool } = await import('../src/db.js');
const { totpCode } = await import('../src/crypto.js');

let server: Server;
let baseUrl = '';
let ipCounter = 0;

interface HttpResult { status: number; json: Record<string, unknown> }
async function http(method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string>; rawBody?: string } = {}): Promise<HttpResult> {
  const headers: Record<string, string> = {
    // IP único por chamada (trust proxy): o rate-limit não interfere entre testes.
    'X-Forwarded-For': `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`,
    ...(opts.headers ?? {}),
  };
  let body: string | undefined;
  if (opts.rawBody !== undefined) { body = opts.rawBody; headers['Content-Type'] ??= 'application/json'; }
  else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers['Content-Type'] = 'application/json'; }
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const res = await fetch(`${baseUrl}${path}`, { method, headers, ...(body !== undefined ? { body } : {}) });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { json = { _raw: text }; }
  return { status: res.status, json };
}

function signedEventHeaders(rawBody: string, secret: string, tsOffsetS = 0): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000) + tsOffsetS;
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  return { 'Content-Type': 'application/json', 'X-Anestbot-Timestamp': String(ts), 'X-Anestbot-Signature': `v1=${sig}` };
}

function envelope(eventType: string, chatRef: string, payload: object, correlationId: string): Record<string, unknown> {
  return {
    event_id: crypto.randomUUID(), event_type: eventType, schema_version: 1,
    occurred_at: new Date().toISOString(), source: 'anestbot2',
    correlation_id: correlationId, chat_ref: chatRef, payload,
  };
}

before(async () => {
  await runMigrations();
  const app = createApp();
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  const addr = server.address();
  if (addr && typeof addr === 'object') baseUrl = `http://127.0.0.1:${addr.port}`;
});
after(async () => {
  server?.close();
  await closePool();
});

// Estado compartilhado entre os testes (montado na ordem).
const S = {
  ownerToken: '', teamA: '', teamB: '', ownerBToken: '',
  secretaryToken: '', viewerToken: '', chatA: 'grupo-a@g.us',
  caseId: '', reviewedCaseId: '',
};

// ── autenticação ────────────────────────────────────────────────────────────
test('health/ready respondem', async () => {
  assert.equal((await http('GET', '/health')).status, 200);
  assert.equal((await http('GET', '/ready')).status, 200);
});

test('registro cria usuário+equipe; e-mail duplicado é 409; senha curta é 400', async () => {
  const r = await http('POST', '/api/auth/register', { body: { email: 'dra.a@example.com', password: 'senha-muito-forte-1', full_name: 'Dra. Ana Sintética', team_name: 'Equipe A', crm: 'CRM-SP-11111' } });
  assert.equal(r.status, 201);
  S.teamA = r.json.team_id as string;

  const dup = await http('POST', '/api/auth/register', { body: { email: 'dra.a@example.com', password: 'senha-muito-forte-1', full_name: 'Xis Ypsilone', team_name: 'Equipe Dup' } });
  assert.equal(dup.status, 409);

  const weak = await http('POST', '/api/auth/register', { body: { email: 'w@example.com', password: 'curta', full_name: 'Xis Ypsilone', team_name: 'Equipe W' } });
  assert.equal(weak.status, 400);

  const rb = await http('POST', '/api/auth/register', { body: { email: 'dr.b@example.com', password: 'senha-muito-forte-2', full_name: 'Dr. Beto Sintético', team_name: 'Equipe B', crm: 'CRM-RJ-22222' } });
  assert.equal(rb.status, 201);
  S.teamB = rb.json.team_id as string;
});

test('login: credencial errada 401 (mensagem única); certa devolve token', async () => {
  const bad = await http('POST', '/api/auth/login', { body: { email: 'dra.a@example.com', password: 'errada-mas-longa' } });
  assert.equal(bad.status, 401);
  const ghost = await http('POST', '/api/auth/login', { body: { email: 'nao-existe@example.com', password: 'qualquer-uma-longa' } });
  assert.equal(ghost.status, 401);
  assert.deepEqual(ghost.json, bad.json, 'mesma resposta para usuário inexistente e senha errada');

  const ok = await http('POST', '/api/auth/login', { body: { email: 'dra.a@example.com', password: 'senha-muito-forte-1' } });
  assert.equal(ok.status, 200);
  S.ownerToken = ok.json.token as string;
  const okB = await http('POST', '/api/auth/login', { body: { email: 'dr.b@example.com', password: 'senha-muito-forte-2' } });
  S.ownerBToken = okB.json.token as string;
});

test('rate limit: 6ª tentativa de login do MESMO IP em 1min é 429', async () => {
  const ip = '203.0.113.77';
  let last = 0;
  for (let i = 0; i < 6; i++) {
    const r = await http('POST', '/api/auth/login', {
      body: { email: 'dra.a@example.com', password: 'errada-mas-longa' },
      headers: { 'X-Forwarded-For': ip },
    });
    last = r.status;
  }
  assert.equal(last, 429);
});

test('sessão revogável: logout invalida o token imediatamente', async () => {
  const login = await http('POST', '/api/auth/login', { body: { email: 'dra.a@example.com', password: 'senha-muito-forte-1' } });
  const tok = login.json.token as string;
  assert.equal((await http('GET', '/api/auth/me', { token: tok })).status, 200);
  assert.equal((await http('POST', '/api/auth/logout', { token: tok })).status, 200);
  assert.equal((await http('GET', '/api/auth/me', { token: tok })).status, 401);
});

test('MFA TOTP: habilita, exige no login, aceita código válido', async () => {
  const setup = await http('POST', '/api/auth/mfa/setup', { token: S.ownerBToken });
  assert.equal(setup.status, 200);
  const secret = setup.json.secret as string;
  const confirm = await http('POST', '/api/auth/mfa/confirm', { token: S.ownerBToken, body: { totp: totpCode(secret) } });
  assert.equal(confirm.status, 200);

  const noTotp = await http('POST', '/api/auth/login', { body: { email: 'dr.b@example.com', password: 'senha-muito-forte-2' } });
  assert.equal(noTotp.status, 401);
  assert.equal(noTotp.json.mfa_required, true);

  const withTotp = await http('POST', '/api/auth/login', { body: { email: 'dr.b@example.com', password: 'senha-muito-forte-2', totp: totpCode(secret) } });
  assert.equal(withTotp.status, 200);
  S.ownerBToken = withTotp.json.token as string;
});

// ── convites e RBAC ─────────────────────────────────────────────────────────
test('convite: uso único com expiração; secretaria e leitura entram na equipe A', async () => {
  const inv1 = await http('POST', `/api/teams/${S.teamA}/invites`, { token: S.ownerToken, body: { email: 'sec.a@example.com', role: 'secretary' } });
  assert.equal(inv1.status, 201);
  const acc1 = await http('POST', '/api/invites/accept', { body: { token: inv1.json.token, password: 'senha-secretaria-1', full_name: 'Secretária Sintética' } });
  assert.equal(acc1.status, 200);
  const reuse = await http('POST', '/api/invites/accept', { body: { token: inv1.json.token, password: 'senha-secretaria-1', full_name: 'De Novo' } });
  assert.equal(reuse.status, 410, 'convite usado não pode ser reutilizado');
  const fake = await http('POST', '/api/invites/accept', { body: { token: 'token-que-nao-existe-123' } });
  assert.equal(fake.status, 404);

  const inv2 = await http('POST', `/api/teams/${S.teamA}/invites`, { token: S.ownerToken, body: { email: 'view.a@example.com', role: 'viewer' } });
  const acc2 = await http('POST', '/api/invites/accept', { body: { token: inv2.json.token, password: 'senha-leitura-01', full_name: 'Leitura Sintética' } });
  assert.equal(acc2.status, 200);

  S.secretaryToken = (await http('POST', '/api/auth/login', { body: { email: 'sec.a@example.com', password: 'senha-secretaria-1' } })).json.token as string;
  S.viewerToken = (await http('POST', '/api/auth/login', { body: { email: 'view.a@example.com', password: 'senha-leitura-01' } })).json.token as string;
  assert.ok(S.secretaryToken && S.viewerToken);
});

test('RBAC: secretaria não convida, não vê auditoria; viewer não cria pendência', async () => {
  const inv = await http('POST', `/api/teams/${S.teamA}/invites`, { token: S.secretaryToken, body: { email: 'x@example.com', role: 'viewer' } });
  assert.equal(inv.status, 403);
  const aud = await http('GET', `/api/teams/${S.teamA}/audit`, { token: S.secretaryToken });
  assert.equal(aud.status, 403);
});

// ── pareamento e inbox ──────────────────────────────────────────────────────
test('pareamento: vincula grupo à equipe A; mesmo grupo em outra equipe é 409', async () => {
  const ok = await http('POST', `/api/teams/${S.teamA}/whatsapp-links`, { token: S.ownerToken, body: { chat_ref: S.chatA, label: 'Grupo A' } });
  assert.equal(ok.status, 201);
  const dup = await http('POST', `/api/teams/${S.teamB}/whatsapp-links`, { token: S.ownerBToken, body: { chat_ref: S.chatA } });
  assert.equal(dup.status, 409, 'um grupo pertence a NO MÁXIMO um tenant');
});

test('inbox: sem assinatura 401 · assinatura errada 401 · expirada 401 · replay antigo 401', async () => {
  const ev = envelope('case.received.v1', S.chatA, { closed_at: new Date().toISOString() }, 'corr-auth-1');
  const raw = JSON.stringify(ev);

  const none = await http('POST', '/internal/events', { rawBody: raw });
  assert.equal(none.status, 401);

  const wrong = await http('POST', '/internal/events', { rawBody: raw, headers: signedEventHeaders(raw, 'segredo-errado') });
  assert.equal(wrong.status, 401);

  const expired = await http('POST', '/internal/events', { rawBody: raw, headers: signedEventHeaders(raw, 'test-secret-primary', -400) });
  assert.equal(expired.status, 401, 'timestamp fora da janela de 300s é replay');
});

test('inbox: segredo ANTERIOR ainda válido (rotação sem downtime)', async () => {
  const ev = envelope('case.received.v1', S.chatA, { closed_at: new Date().toISOString() }, 'corr-rotacao');
  const raw = JSON.stringify(ev);
  const r = await http('POST', '/internal/events', { rawBody: raw, headers: signedEventHeaders(raw, 'test-secret-old') });
  assert.equal(r.status, 200);
});

test('inbox: chat NÃO pareado é 409 (vai à dead-letter do bot até parear)', async () => {
  const ev = envelope('case.received.v1', 'grupo-desconhecido@g.us', {}, 'corr-x');
  const raw = JSON.stringify(ev);
  const r = await http('POST', '/internal/events', { rawBody: raw, headers: signedEventHeaders(raw, 'test-secret-primary') });
  assert.equal(r.status, 409);
});

test('inbox: envelope fora do contrato é 400; corpo não-JSON é 400', async () => {
  const bad = { ...envelope('case.received.v1', S.chatA, {}, 'c'), event_type: 'SEM VERSAO' };
  const raw = JSON.stringify(bad);
  const r = await http('POST', '/internal/events', { rawBody: raw, headers: signedEventHeaders(raw, 'test-secret-primary') });
  assert.equal(r.status, 400);
  const rawJunk = 'isto não é json';
  const junk = await http('POST', '/internal/events', { rawBody: rawJunk, headers: signedEventHeaders(rawJunk, 'test-secret-primary') });
  assert.equal(junk.status, 400);
});

test('inbox: evento DUPLICADO processa uma única vez (idempotência)', async () => {
  const corr = `${S.chatA}:1754300001`;
  const ev = envelope('case.received.v1', S.chatA, { closed_at: new Date().toISOString() }, corr);
  const raw = JSON.stringify(ev);
  const h = signedEventHeaders(raw, 'test-secret-primary');
  const r1 = await http('POST', '/internal/events', { rawBody: raw, headers: h });
  assert.equal(r1.status, 200);
  const r2 = await http('POST', '/internal/events', { rawBody: raw, headers: h });
  assert.equal(r2.status, 200);
  assert.equal(r2.json.duplicate, true, 'segunda entrega é reconhecida como duplicata');

  const list = await http('GET', `/api/teams/${S.teamA}/cases`, { token: S.ownerToken });
  const cases = (list.json.cases as { correlation_id?: string }[]);
  const matching = cases.filter((c) => true); // contagem por correlação vem abaixo via SQL
  assert.ok(matching.length >= 1);
  const q = await getPool().query('SELECT count(*)::int AS n FROM cases WHERE team_id = $1 AND correlation_id = $2', [S.teamA, corr]);
  assert.equal((q.rows[0] as { n: number }).n, 1, 'exatamente UM caso para o evento duplicado');
});

test('inbox: fluxo completo received→started→completed cria análise e paciente', async () => {
  const corr = `${S.chatA}:1754300100`;
  const send = async (type: string, payload: object) => {
    const ev = envelope(type, S.chatA, payload, corr);
    const raw = JSON.stringify(ev);
    return http('POST', '/internal/events', { rawBody: raw, headers: signedEventHeaders(raw, 'test-secret-primary') });
  };
  assert.equal((await send('case.received.v1', { closed_at: new Date().toISOString() })).status, 200);
  assert.equal((await send('case.analysis_started.v1', { case_index: 1, total_cases: 1 })).status, 200);
  assert.equal((await send('case.analysis_completed.v1', {
    patient_name: 'Paciente Fluxo Sintética', surgery: 'Rinoplastia (demo)',
    anamnesis: 'Anamnese sintética de teste — sem dados reais.',
    report_text: '🧾 *AVALIAÇÃO PRÉ-ANESTÉSICA*\n━━━\nParecer sintético.',
    files: { attached: ['hemograma.pdf'], failed: [], oversized: [], degraded: [] },
    errors: [], analysis: { model: 'claude-sonnet-4-6', prompt_rev: '2026-08-04.1' },
  })).status, 200);

  const q = await getPool().query('SELECT id, status, patient_id, surgery FROM cases WHERE team_id = $1 AND correlation_id = $2', [S.teamA, corr]);
  const row = q.rows[0] as { id: string; status: string; patient_id: string | null; surgery: string };
  assert.equal(row.status, 'analyzed');
  assert.ok(row.patient_id, 'paciente associado automaticamente');
  assert.equal(row.surgery, 'Rinoplastia (demo)');
  S.caseId = row.id;

  const detail = await http('GET', `/api/teams/${S.teamA}/cases/${row.id}`, { token: S.ownerToken });
  assert.equal(detail.status, 200);
  const analyses = detail.json.analyses as { seq: number; report_text: string }[];
  assert.equal(analyses.length, 1);
  assert.ok(analyses[0]?.report_text.includes('Parecer sintético'));
});

test('inbox: reanálise gera seq 2 SEM apagar a análise anterior (versionada)', async () => {
  const corr = `${S.chatA}:1754300100`;
  const ev = envelope('case.analysis_completed.v1', S.chatA, {
    patient_name: 'Paciente Fluxo Sintética', surgery: 'Rinoplastia (demo)',
    anamnesis: 'Anamnese sintética v2.', report_text: 'Parecer sintético v2.',
    analysis: { model: 'claude-sonnet-4-6', prompt_rev: '2026-08-04.1' },
  }, corr);
  const raw = JSON.stringify(ev);
  assert.equal((await http('POST', '/internal/events', { rawBody: raw, headers: signedEventHeaders(raw, 'test-secret-primary') })).status, 200);
  const q = await getPool().query('SELECT count(*)::int AS n, max(seq)::int AS mx FROM case_analyses WHERE case_id = $1', [S.caseId]);
  const row = q.rows[0] as { n: number; mx: number };
  assert.equal(row.n, 2);
  assert.equal(row.mx, 2);
});

test('inbox: payload acima de 1MB é rejeitado (413)', async () => {
  const ev = envelope('case.analysis_completed.v1', S.chatA, { report_text: 'x'.repeat(1_200_000) }, 'corr-grande');
  const raw = JSON.stringify(ev);
  const r = await http('POST', '/internal/events', { rawBody: raw, headers: signedEventHeaders(raw, 'test-secret-primary') });
  assert.equal(r.status, 413);
});

// ── isolamento de tenant (cenário 1 do prompt-mestre) ───────────────────────
test('ISOLAMENTO: equipe B não acessa NADA da equipe A (404, sem vazar existência)', async () => {
  assert.equal((await http('GET', `/api/teams/${S.teamA}/cases`, { token: S.ownerBToken })).status, 404);
  assert.equal((await http('GET', `/api/teams/${S.teamA}/cases/${S.caseId}`, { token: S.ownerBToken })).status, 404);
  assert.equal((await http('GET', `/api/teams/${S.teamA}/dashboard`, { token: S.ownerBToken })).status, 404);
  assert.equal((await http('GET', `/api/teams/${S.teamA}/patients`, { token: S.ownerBToken })).status, 404);
  // Caso da equipe A "pelo caminho" da equipe B: escopo por team_id nega (404).
  assert.equal((await http('GET', `/api/teams/${S.teamB}/cases/${S.caseId}`, { token: S.ownerBToken })).status, 404);
  const review = await http('POST', `/api/teams/${S.teamB}/cases/${S.caseId}/review`, { token: S.ownerBToken, body: { decision: 'approved' } });
  assert.equal(review.status, 404, 'revisar caso de outro tenant é 404');
});

// ── secretaria vs. campos clínicos (cenário 2) ──────────────────────────────
test('SECRETARIA: vê o caso operacional, NUNCA anamnese/parecer (redação server-side)', async () => {
  const r = await http('GET', `/api/teams/${S.teamA}/cases/${S.caseId}`, { token: S.secretaryToken });
  assert.equal(r.status, 200);
  assert.equal(r.json.clinical_access, false);
  assert.deepEqual(r.json.analyses, [], 'análises omitidas para a secretaria');
  const dump = JSON.stringify(r.json);
  assert.ok(!dump.includes('Anamnese sintética'), 'anamnese não pode vazar');
  assert.ok(!dump.includes('Parecer sintético'), 'parecer não pode vazar');

  const rev = await http('POST', `/api/teams/${S.teamA}/cases/${S.caseId}/review`, { token: S.secretaryToken, body: { decision: 'approved' } });
  assert.equal(rev.status, 403, 'secretaria nunca revisa');
});

test('VIEWER: lê conteúdo clínico mas não gerencia pendências', async () => {
  const r = await http('GET', `/api/teams/${S.teamA}/cases/${S.caseId}`, { token: S.viewerToken });
  assert.equal(r.status, 200);
  assert.equal(r.json.clinical_access, true);
  const pend = await http('POST', `/api/teams/${S.teamA}/cases/${S.caseId}/pending-items`, { token: S.viewerToken, body: { description: 'x' } });
  assert.equal(pend.status, 403);
});

// ── revisão médica e override ───────────────────────────────────────────────
test('revisão: caso "received" não revisável (409); analisado revisável; CRM registrado', async () => {
  const corr = `${S.chatA}:1754300200`;
  const ev = envelope('case.received.v1', S.chatA, { closed_at: new Date().toISOString() }, corr);
  const raw = JSON.stringify(ev);
  await http('POST', '/internal/events', { rawBody: raw, headers: signedEventHeaders(raw, 'test-secret-primary') });
  const q = await getPool().query('SELECT id FROM cases WHERE team_id = $1 AND correlation_id = $2', [S.teamA, corr]);
  const receivedId = (q.rows[0] as { id: string }).id;

  const early = await http('POST', `/api/teams/${S.teamA}/cases/${receivedId}/review`, { token: S.ownerToken, body: { decision: 'approved' } });
  assert.equal(early.status, 409, 'não se revisa caso sem análise');

  const ok = await http('POST', `/api/teams/${S.teamA}/cases/${S.caseId}/review`, { token: S.ownerToken, body: { decision: 'needs_items', note: 'Aguardar exame complementar.' } });
  assert.equal(ok.status, 201);
  const detail = await http('GET', `/api/teams/${S.teamA}/cases/${S.caseId}`, { token: S.ownerToken });
  const kase = detail.json.case as { status: string };
  assert.equal(kase.status, 'reviewed');
  const reviews = detail.json.reviews as { reviewer_crm: string; decision: string }[];
  assert.equal(reviews[0]?.reviewer_crm, 'CRM-SP-11111');
  S.reviewedCaseId = S.caseId;
});

test('revisão sem CRM no perfil é 403 (decisão é de médico IDENTIFICADO)', async () => {
  // A secretária não tem case:review; para isolar a regra do CRM, criamos um
  // anesthesiologist SEM CRM via convite.
  const inv = await http('POST', `/api/teams/${S.teamA}/invites`, { token: S.ownerToken, body: { email: 'anest.semcrm@example.com', role: 'anesthesiologist' } });
  await http('POST', '/api/invites/accept', { body: { token: inv.json.token, password: 'senha-anest-0001', full_name: 'Anest Sem CRM' } });
  const tok = (await http('POST', '/api/auth/login', { body: { email: 'anest.semcrm@example.com', password: 'senha-anest-0001' } })).json.token as string;
  const r = await http('POST', `/api/teams/${S.teamA}/cases/${S.reviewedCaseId}/review`, { token: tok, body: { decision: 'approved' } });
  assert.equal(r.status, 403);
  assert.match(String(r.json.error), /CRM/);
});

test('override: exige motivo (400 sem) e registra identidade+CRM+motivo', async () => {
  const noReason = await http('POST', `/api/teams/${S.teamA}/cases/${S.caseId}/override`, { token: S.ownerToken, body: { decision: 'approved' } });
  assert.equal(noReason.status, 400);
  const ok = await http('POST', `/api/teams/${S.teamA}/cases/${S.caseId}/override`, { token: S.ownerToken, body: { decision: 'approved', reason: 'Avaliação presencial complementar realizada.' } });
  assert.equal(ok.status, 201);
  const q = await getPool().query('SELECT crm, reason FROM overrides WHERE case_id = $1', [S.caseId]);
  const row = q.rows[0] as { crm: string; reason: string };
  assert.equal(row.crm, 'CRM-SP-11111');
  assert.ok(row.reason.length >= 5);
});

// ── imutabilidade e máquina de estados ──────────────────────────────────────
test('IMUTABILIDADE: UPDATE/DELETE em revisões e análises é bloqueado pelo BANCO', async () => {
  await assert.rejects(
    getPool().query(`UPDATE medical_reviews SET decision = 'approved'`),
    /append-only/,
  );
  await assert.rejects(getPool().query('DELETE FROM medical_reviews'), /append-only/);
  await assert.rejects(getPool().query(`UPDATE case_analyses SET report_text = 'adulterado'`), /append-only/);
  await assert.rejects(getPool().query('DELETE FROM audit_logs'), /append-only/);
});

test('máquina de estados: caso revisado NÃO regride com evento atrasado', async () => {
  const corr = `${S.chatA}:1754300100`; // caso já revisado
  const ev = envelope('case.analysis_started.v1', S.chatA, {}, corr);
  const raw = JSON.stringify(ev);
  const r = await http('POST', '/internal/events', { rawBody: raw, headers: signedEventHeaders(raw, 'test-secret-primary') });
  assert.equal(r.status, 200, 'evento é aceito (recibo) mas não corrompe');
  const q = await getPool().query('SELECT status FROM cases WHERE id = $1', [S.caseId]);
  assert.equal((q.rows[0] as { status: string }).status, 'reviewed', 'status permanece reviewed');
});

// ── pendências, pacientes, dashboard, auditoria ─────────────────────────────
test('pendências: secretaria cria e resolve (é o papel operacional dela)', async () => {
  const c = await http('POST', `/api/teams/${S.teamA}/cases/${S.caseId}/pending-items`, { token: S.secretaryToken, body: { description: 'Reenviar hemograma legível' } });
  assert.equal(c.status, 201);
  const done = await http('POST', `/api/teams/${S.teamA}/cases/${S.caseId}/pending-items/${c.json.item_id}/resolve`, { token: S.secretaryToken });
  assert.equal(done.status, 200);
});

test('pacientes: criação detecta homônimo (dedup ASSISTIDA, nunca fusão)', async () => {
  const p1 = await http('POST', `/api/teams/${S.teamA}/patients`, { token: S.ownerToken, body: { full_name: 'Homônima Sintética' } });
  assert.equal(p1.status, 201);
  const p2 = await http('POST', `/api/teams/${S.teamA}/patients`, { token: S.ownerToken, body: { full_name: 'homônima sintética' } });
  assert.equal(p2.status, 201);
  const dupes = p2.json.possible_duplicates as unknown[];
  assert.equal(dupes.length, 1, 'homônimo é REPORTADO, não fundido');
  assert.notEqual(p1.json.patient_id, p2.json.patient_id);
});

test('dashboard: agrega por status e conta pendências sem vazar entre tenants', async () => {
  const a = await http('GET', `/api/teams/${S.teamA}/dashboard`, { token: S.ownerToken });
  assert.equal(a.status, 200);
  const byStatus = a.json.cases_by_status as Record<string, number>;
  assert.ok(Object.values(byStatus).reduce((s, n) => s + n, 0) >= 3);

  const b = await http('GET', `/api/teams/${S.teamB}/dashboard`, { token: S.ownerBToken });
  assert.equal(b.status, 200);
  const byStatusB = b.json.cases_by_status as Record<string, number>;
  assert.equal(Object.values(byStatusB).reduce((s, n) => s + n, 0), 0, 'equipe B não herda casos da A');
});

test('auditoria: registra ações-chave e NUNCA contém conteúdo clínico', async () => {
  const r = await http('GET', `/api/teams/${S.teamA}/audit`, { token: S.ownerToken });
  assert.equal(r.status, 200);
  const entries = r.json.entries as { action: string }[];
  const actions = new Set(entries.map((e) => e.action));
  for (const expected of ['case.reviewed', 'case.override_recorded', 'case.viewed', 'pairing.created', 'invite.created']) {
    assert.ok(actions.has(expected), `auditoria deve conter ${expected}`);
  }
  const dump = JSON.stringify(entries);
  assert.ok(!dump.includes('Anamnese sintética'), 'anamnese não pode estar na auditoria');
  assert.ok(!dump.includes('Parecer sintético'), 'parecer não pode estar na auditoria');
});

// ── PHI nos logs do servidor (cenário 20.12 do prompt-mestre) ───────────────
test('LOGS: processar evento clínico não escreve PHI no console', async () => {
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); };
  try {
    const corr = `${S.chatA}:1754300300`;
    const recv = envelope('case.received.v1', S.chatA, { closed_at: new Date().toISOString() }, corr);
    let raw = JSON.stringify(recv);
    await http('POST', '/internal/events', { rawBody: raw, headers: signedEventHeaders(raw, 'test-secret-primary') });
    const done = envelope('case.analysis_completed.v1', S.chatA, {
      patient_name: 'Nome Ultrassecreto Da Silva', anamnesis: 'HIV positivo sintético',
      report_text: 'Hb 9,9 sintética', analysis: {},
    }, corr);
    raw = JSON.stringify(done);
    await http('POST', '/internal/events', { rawBody: raw, headers: signedEventHeaders(raw, 'test-secret-primary') });
  } finally {
    console.error = orig;
  }
  const all = logged.join('\n');
  assert.ok(!all.includes('Ultrassecreto'), 'nome de paciente vazou para o log');
  assert.ok(!all.includes('HIV positivo'), 'anamnese vazou para o log');
  assert.ok(!all.includes('Hb 9,9'), 'parecer vazou para o log');
});
