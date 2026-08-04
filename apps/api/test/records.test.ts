// Marco 3 — prontuário anestésico: imutabilidade do registro assinado
// (cenário 14 do prompt-mestre), hash verificável e adendos rastreáveis.
// Roda em Postgres REAL (testdb.sh, concorrência 1 — mesma base da suíte).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';

process.env.PLATFORM_EVENTS_SECRET ??= 'test-secret-primary';

const { runMigrations } = await import('../src/migrate.js');
const { createApp } = await import('../src/app.js');
const { getPool, closePool } = await import('../src/db.js');
const { canonicalStringify, snapshotHash } = await import('../src/canonical.js');

let server: Server;
let baseUrl = '';
let ipc = 0;

interface HttpResult { status: number; json: Record<string, unknown> }
async function http(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<HttpResult> {
  const headers: Record<string, string> = { 'X-Forwarded-For': `10.9.${Math.floor(ipc / 250)}.${(ipc++ % 250) + 1}` };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers['Content-Type'] = 'application/json'; }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, ...(body !== undefined ? { body } : {}) });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { json = {}; }
  return { status: res.status, json };
}

const S = { doctorToken: '', teamR: '', noCrmToken: '', secToken: '', otherTeam: '', otherToken: '', recordId: '' };

before(async () => {
  await runMigrations();
  const app = createApp();
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  const addr = server.address();
  if (addr && typeof addr === 'object') baseUrl = `http://127.0.0.1:${addr.port}`;

  const reg = await http('POST', '/api/auth/register', { body: { email: 'rec.dra@example.com', password: 'senha-registro-01', full_name: 'Dra. Registro Sintética', team_name: 'Equipe Registro', crm: 'CRM-PB-33333' } });
  S.teamR = reg.json.team_id as string;
  S.doctorToken = (await http('POST', '/api/auth/login', { body: { email: 'rec.dra@example.com', password: 'senha-registro-01' } })).json.token as string;

  const invA = await http('POST', `/api/teams/${S.teamR}/invites`, { token: S.doctorToken, body: { email: 'rec.semcrm@example.com', role: 'anesthesiologist' } });
  await http('POST', '/api/invites/accept', { body: { token: invA.json.token, password: 'senha-registro-02', full_name: 'Anest Sem CRM Rec' } });
  S.noCrmToken = (await http('POST', '/api/auth/login', { body: { email: 'rec.semcrm@example.com', password: 'senha-registro-02' } })).json.token as string;

  const invS = await http('POST', `/api/teams/${S.teamR}/invites`, { token: S.doctorToken, body: { email: 'rec.sec@example.com', role: 'secretary' } });
  await http('POST', '/api/invites/accept', { body: { token: invS.json.token, password: 'senha-registro-03', full_name: 'Sec Registro' } });
  S.secToken = (await http('POST', '/api/auth/login', { body: { email: 'rec.sec@example.com', password: 'senha-registro-03' } })).json.token as string;

  const regB = await http('POST', '/api/auth/register', { body: { email: 'rec.outro@example.com', password: 'senha-registro-04', full_name: 'Dr. Outro Time', team_name: 'Equipe Alheia', crm: 'CRM-CE-44444' } });
  S.otherTeam = regB.json.team_id as string;
  S.otherToken = (await http('POST', '/api/auth/login', { body: { email: 'rec.outro@example.com', password: 'senha-registro-04' } })).json.token as string;
});
after(async () => { server?.close(); await closePool(); });

test('canonicalStringify: determinístico e ordena chaves (base do hash)', () => {
  const a = canonicalStringify({ b: 1, a: { z: true, m: [3, 1] } } as never);
  const b = canonicalStringify({ a: { m: [3, 1], z: true }, b: 1 } as never);
  assert.equal(a, b);
  assert.equal(a, '{"a":{"m":[3,1],"z":true},"b":1}');
  const h1 = snapshotHash({ record_id: 'x', team_id: 'y', case_id: null, patient_id: null, pre: {}, intra: {}, post: {}, events: [], vitals: [] });
  const h2 = snapshotHash({ record_id: 'x', team_id: 'y', case_id: null, patient_id: null, pre: {}, intra: {}, post: {}, events: [], vitals: [] });
  assert.equal(h1.hash, h2.hash);
  assert.match(h1.hash, /^[0-9a-f]{64}$/);
});

test('rascunho: cria com template versionado, edita, adiciona eventos e vitais', async () => {
  const t1 = await http('POST', `/api/teams/${S.teamR}/record-templates`, { token: S.doctorToken, body: { name: 'Rotina Mamo', content: { pre: { asa: 'I' } } } });
  assert.equal(t1.status, 201);
  assert.equal(t1.json.version, 1);
  const t2 = await http('POST', `/api/teams/${S.teamR}/record-templates`, { token: S.doctorToken, body: { name: 'Rotina Mamo', content: { pre: { asa: 'II' } } } });
  assert.equal(t2.json.version, 2, 'mesmo nome incrementa versão — nunca sobrescreve');

  const rec = await http('POST', `/api/teams/${S.teamR}/records`, {
    token: S.doctorToken,
    body: { template_id: t2.json.template_id as string, intra: { tecnica: 'geral balanceada' } },
  });
  assert.equal(rec.status, 201);
  S.recordId = rec.json.record_id as string;

  const upd = await http('PUT', `/api/teams/${S.teamR}/records/${S.recordId}`, {
    token: S.doctorToken,
    body: { pre: { asa: 'II', jejum_h: 8, alergias: ['dipirona (sintético)'] }, post: { aldrete: 10, destino: 'RPA' } },
  });
  assert.equal(upd.status, 200);

  const ev = await http('POST', `/api/teams/${S.teamR}/records/${S.recordId}/events`, {
    token: S.doctorToken,
    body: { at: '2026-08-04T13:00:00Z', kind: 'drug', description: 'Propofol (sintético)', dose: '120 mg' },
  });
  assert.equal(ev.status, 201);
  const vi = await http('POST', `/api/teams/${S.teamR}/records/${S.recordId}/vitals`, {
    token: S.doctorToken,
    body: { at: '2026-08-04T13:05:00Z', hr: 72, sbp: 118, dbp: 74, spo2: 99, temp_c: 36.4 },
  });
  assert.equal(vi.status, 201);

  const bad = await http('POST', `/api/teams/${S.teamR}/records/${S.recordId}/vitals`, {
    token: S.doctorToken, body: { at: '2026-08-04T13:06:00Z', spo2: 250 },
  });
  assert.equal(bad.status, 400, 'SpO2 250% é rejeitado por schema');
});

test('RBAC do prontuário: secretaria não lê nem escreve (é conteúdo clínico)', async () => {
  assert.equal((await http('GET', `/api/teams/${S.teamR}/records/${S.recordId}`, { token: S.secToken })).status, 403);
  const w = await http('POST', `/api/teams/${S.teamR}/records`, { token: S.secToken, body: {} });
  assert.equal(w.status, 403);
});

test('ISOLAMENTO: outro tenant não acessa o registro (404)', async () => {
  assert.equal((await http('GET', `/api/teams/${S.teamR}/records/${S.recordId}`, { token: S.otherToken })).status, 404);
  assert.equal((await http('GET', `/api/teams/${S.otherTeam}/records/${S.recordId}`, { token: S.otherToken })).status, 404);
});

test('assinar sem CRM é 403; com CRM congela hash sha256 do snapshot canônico', async () => {
  const no = await http('POST', `/api/teams/${S.teamR}/records/${S.recordId}/sign`, { token: S.noCrmToken });
  assert.equal(no.status, 403);
  assert.match(String(no.json.error), /CRM/);

  const ok = await http('POST', `/api/teams/${S.teamR}/records/${S.recordId}/sign`, { token: S.doctorToken });
  assert.equal(ok.status, 201);
  assert.match(String(ok.json.content_hash), /^[0-9a-f]{64}$/);

  const again = await http('POST', `/api/teams/${S.teamR}/records/${S.recordId}/sign`, { token: S.doctorToken });
  assert.equal(again.status, 409, 'não se assina duas vezes');
});

test('CENÁRIO 14: registro ASSINADO não pode ser alterado — pela API e pelo BANCO', async () => {
  // Pela API: 409 em toda mutação.
  const upd = await http('PUT', `/api/teams/${S.teamR}/records/${S.recordId}`, { token: S.doctorToken, body: { pre: { asa: 'III' } } });
  assert.equal(upd.status, 409);
  const ev = await http('POST', `/api/teams/${S.teamR}/records/${S.recordId}/events`, {
    token: S.doctorToken, body: { at: '2026-08-04T14:00:00Z', kind: 'note', description: 'tentativa pós-assinatura' },
  });
  assert.equal(ev.status, 409);
  const vi = await http('POST', `/api/teams/${S.teamR}/records/${S.recordId}/vitals`, { token: S.doctorToken, body: { at: '2026-08-04T14:00:00Z', hr: 80 } });
  assert.equal(vi.status, 409);

  // Pelo banco: mesmo um UPDATE direto (bypass da API) é bloqueado por trigger.
  await assert.rejects(getPool().query(`UPDATE anesthesia_records SET pre = '{"adulterado":true}' WHERE id = $1`, [S.recordId]), /imutável/);
  await assert.rejects(getPool().query('DELETE FROM anesthesia_records WHERE id = $1', [S.recordId]), /imutável/);
  await assert.rejects(getPool().query(`INSERT INTO anesthesia_events (id, team_id, record_id, at, kind, description, created_by)
    SELECT gen_random_uuid(), team_id, id, now(), 'note', 'inserção direta', created_by FROM anesthesia_records WHERE id = $1`, [S.recordId]), /imutável/);
  await assert.rejects(getPool().query('DELETE FROM vitals WHERE record_id = $1', [S.recordId]), /imutável/);
  await assert.rejects(getPool().query(`UPDATE signatures SET content_hash = repeat('0', 64) WHERE record_id = $1`, [S.recordId]), /append-only/);
});

test('verificação: GET devolve verified=true e o hash bate com o canônico', async () => {
  const r = await http('GET', `/api/teams/${S.teamR}/records/${S.recordId}`, { token: S.doctorToken });
  assert.equal(r.status, 200);
  const verification = r.json.verification as { verified: boolean; content_hash: string };
  assert.equal(verification.verified, true, 'conteúdo atual confere com o hash assinado');
  const sig = r.json.signature as { signer_crm: string; content_hash: string };
  assert.equal(sig.signer_crm, 'CRM-PB-33333');
});

test('adendo: proibido em rascunho (409), permitido em assinado, com CRM e rastreável', async () => {
  const draft = await http('POST', `/api/teams/${S.teamR}/records`, { token: S.doctorToken, body: {} });
  const draftId = draft.json.record_id as string;
  const onDraft = await http('POST', `/api/teams/${S.teamR}/records/${draftId}/addenda`, { token: S.doctorToken, body: { content: 'não deveria' } });
  assert.equal(onDraft.status, 409);

  const noCrm = await http('POST', `/api/teams/${S.teamR}/records/${S.recordId}/addenda`, { token: S.noCrmToken, body: { content: 'sem crm não pode' } });
  assert.equal(noCrm.status, 403);

  const ok = await http('POST', `/api/teams/${S.teamR}/records/${S.recordId}/addenda`, {
    token: S.doctorToken, body: { content: 'Correção: dose de propofol registrada era 110 mg (sintético).' },
  });
  assert.equal(ok.status, 201);

  const detail = await http('GET', `/api/teams/${S.teamR}/records/${S.recordId}`, { token: S.doctorToken });
  const addenda = detail.json.addenda as { author_crm: string; content: string }[];
  assert.equal(addenda.length, 1);
  assert.equal(addenda[0]?.author_crm, 'CRM-PB-33333');
  // O adendo NÃO altera o snapshot assinado: verificação continua íntegra.
  assert.equal((detail.json.verification as { verified: boolean }).verified, true);

  await assert.rejects(getPool().query('DELETE FROM record_addenda'), /append-only/, 'adendo nunca é apagado');
});

test('auditoria do prontuário: created/signed/addendum presentes, sem conteúdo clínico', async () => {
  const r = await http('GET', `/api/teams/${S.teamR}/audit`, { token: S.doctorToken });
  const entries = r.json.entries as { action: string }[];
  const actions = new Set(entries.map((e) => e.action));
  for (const a of ['record.created', 'record.signed', 'record.addendum_added', 'record.viewed']) {
    assert.ok(actions.has(a), `auditoria deve conter ${a}`);
  }
  const dump = JSON.stringify(entries);
  assert.ok(!dump.includes('Propofol'), 'droga/dose não vai para a auditoria');
  assert.ok(!dump.includes('dipirona'), 'alergia não vai para a auditoria');
});
