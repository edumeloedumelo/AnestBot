// Marco 5 (parcial) — biblioteca clínica: versões imutáveis após aprovação,
// aprovador médico com CRM, busca em português, distinção institucional ×
// referência externa, aviso de apoio à decisão.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';

process.env.PLATFORM_EVENTS_SECRET ??= 'test-secret-primary';

const { runMigrations } = await import('../src/migrate.js');
const { createApp } = await import('../src/app.js');
const { getPool, closePool } = await import('../src/db.js');

let server: Server;
let baseUrl = '';
let ipc = 0;

interface HttpResult { status: number; json: Record<string, unknown> }
async function http(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<HttpResult> {
  const headers: Record<string, string> = { 'X-Forwarded-For': `10.5.${Math.floor(ipc / 250)}.${(ipc++ % 250) + 1}` };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers['Content-Type'] = 'application/json'; }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, ...(body !== undefined ? { body } : {}) });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { json = {}; }
  return { status: res.status, json };
}

const S = { doctor: '', noCrm: '', sec: '', team: '', topic: '' };

before(async () => {
  await runMigrations();
  const app = createApp();
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  const addr = server.address();
  if (addr && typeof addr === 'object') baseUrl = `http://127.0.0.1:${addr.port}`;

  const reg = await http('POST', '/api/auth/register', { body: { email: 'lib.dra@example.com', password: 'senha-biblioteca1', full_name: 'Dra. Biblioteca', team_name: 'Equipe Biblioteca', crm: 'CRM-BA-66666' } });
  S.team = reg.json.team_id as string;
  S.doctor = (await http('POST', '/api/auth/login', { body: { email: 'lib.dra@example.com', password: 'senha-biblioteca1' } })).json.token as string;

  const inv = await http('POST', `/api/teams/${S.team}/invites`, { token: S.doctor, body: { email: 'lib.semcrm@example.com', role: 'anesthesiologist' } });
  await http('POST', '/api/invites/accept', { body: { token: inv.json.token, password: 'senha-biblioteca2', full_name: 'Anest Sem CRM Lib' } });
  S.noCrm = (await http('POST', '/api/auth/login', { body: { email: 'lib.semcrm@example.com', password: 'senha-biblioteca2' } })).json.token as string;

  const invS = await http('POST', `/api/teams/${S.team}/invites`, { token: S.doctor, body: { email: 'lib.sec@example.com', role: 'secretary' } });
  await http('POST', '/api/invites/accept', { body: { token: invS.json.token, password: 'senha-biblioteca3', full_name: 'Sec Lib' } });
  S.sec = (await http('POST', '/api/auth/login', { body: { email: 'lib.sec@example.com', password: 'senha-biblioteca3' } })).json.token as string;
});
after(async () => { server?.close(); await closePool(); });

test('protocolo institucional: rascunho NÃO aparece na busca até aprovação', async () => {
  const t = await http('POST', `/api/teams/${S.team}/topics`, {
    token: S.doctor,
    body: { slug: 'jejum-pre-operatorio', kind: 'institutional', title: 'Jejum pré-operatório',
      content_md: '## Jejum\nLíquidos claros: 2h. Leite materno: 4h. Sólidos: 8h. (Conteúdo sintético.)' },
  });
  assert.equal(t.status, 201);
  assert.equal(t.json.status, 'draft');
  S.topic = t.json.topic_id as string;

  const search = await http('GET', `/api/teams/${S.team}/topics?q=jejum`, { token: S.doctor });
  assert.equal((search.json.topics as unknown[]).length, 0, 'rascunho não é visível na biblioteca');
  assert.match(String(search.json.disclaimer), /não substitui/i, 'aviso de apoio à decisão sempre presente');
});

test('referência externa sem fonte é 400 (distinção honesta)', async () => {
  const r = await http('POST', `/api/teams/${S.team}/topics`, {
    token: S.doctor,
    body: { slug: 'diretriz-asa-jejum', kind: 'external_reference', title: 'Diretriz externa', content_md: 'Resumo sintético da diretriz.' },
  });
  assert.equal(r.status, 400);
  assert.match(String(r.json.error), /source_label/);
});

test('aprovação: sem CRM 403; com CRM aprova, registra aprovador e publica na busca', async () => {
  const no = await http('POST', `/api/teams/${S.team}/topics/${S.topic}/versions/1/approve`, { token: S.noCrm });
  assert.equal(no.status, 403);
  assert.match(String(no.json.error), /CRM/);

  const ok = await http('POST', `/api/teams/${S.team}/topics/${S.topic}/versions/1/approve`, { token: S.doctor });
  assert.equal(ok.status, 200);

  const search = await http('GET', `/api/teams/${S.team}/topics?q=jejum`, { token: S.sec });
  const found = search.json.topics as { slug: string; version: number; approved_crm: string }[];
  assert.equal(found.length, 1, 'aprovado aparece na busca (inclusive para a secretaria — não é PHI)');
  assert.equal(found[0]?.approved_crm, 'CRM-BA-66666');

  // Busca com flexão portuguesa ("líquidos" no corpo).
  const stem = await http('GET', `/api/teams/${S.team}/topics?q=líquidos claros`, { token: S.doctor });
  assert.equal((stem.json.topics as unknown[]).length, 1, 'full-text em português encontra pelo conteúdo');
});

test('versão nova: v2 draft não substitui v1 aprovada até ser aprovada; v1 vira retired', async () => {
  const v2 = await http('POST', `/api/teams/${S.team}/topics/${S.topic}/versions`, {
    token: S.doctor,
    body: { title: 'Jejum pré-operatório (rev. 2)', content_md: '## Jejum v2\nAtualização sintética: goma de mascar 2h.' },
  });
  assert.equal(v2.status, 201);
  assert.equal(v2.json.version, 2);

  const detail1 = await http('GET', `/api/teams/${S.team}/topics/${S.topic}`, { token: S.doctor });
  assert.equal((detail1.json.current as { version: number }).version, 1, 'vigente ainda é a v1');

  await http('POST', `/api/teams/${S.team}/topics/${S.topic}/versions/2/approve`, { token: S.doctor });
  const detail2 = await http('GET', `/api/teams/${S.team}/topics/${S.topic}`, { token: S.doctor });
  assert.equal((detail2.json.current as { version: number }).version, 2);
  const history = detail2.json.history as { version: number; status: string }[];
  assert.equal(history.find((h) => h.version === 1)?.status, 'retired', 'v1 preservada como retired — nunca apagada');
});

test('IMUTABILIDADE: versão aprovada não pode ser editada nem apagada (trigger)', async () => {
  await assert.rejects(
    getPool().query(`UPDATE topic_versions SET content_md = 'adulterado com mais de dez chars' WHERE topic_id = $1 AND version = 2`, [S.topic]),
    /imutável/,
  );
  await assert.rejects(
    getPool().query('DELETE FROM topic_versions WHERE topic_id = $1 AND version = 1', [S.topic]),
    /imutável/,
  );
});

test('RBAC: secretaria lê mas não escreve; slug duplicado 409', async () => {
  const w = await http('POST', `/api/teams/${S.team}/topics`, { token: S.sec, body: { slug: 'tentativa-sec', kind: 'institutional', title: 'Tentativa', content_md: 'Não deveria funcionar aqui.' } });
  assert.equal(w.status, 403);
  const dup = await http('POST', `/api/teams/${S.team}/topics`, { token: S.doctor, body: { slug: 'jejum-pre-operatorio', kind: 'institutional', title: 'Duplicado', content_md: 'Slug repetido deve falhar.' } });
  assert.equal(dup.status, 409);
});
