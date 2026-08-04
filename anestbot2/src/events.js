// ─────────────────────────────────────────────────────────────────────────
// OUTBOX de eventos bot → plataforma (Marco 1 — contrato em packages/contracts).
//
// Garantias:
//   • DURÁVEL ANTES DE ENVIAR: o evento é gravado em STATE_DIR (volume
//     persistente, escrita atômica) antes de qualquer tentativa de entrega —
//     a plataforma pode ficar fora do ar por horas sem perder nada.
//   • ENTREGA EM ORDEM (FIFO) com retentativas: backoff exponencial + jitter.
//   • NUNCA DESCARTA silenciosamente: após OUTBOX_MAX_ATTEMPTS (ou erro 4xx
//     permanente) o evento vai para a dead-letter, visível no /diag e no
//     comando /fila; replay manual com /fila reenviar (mesmos event_id — o
//     receptor deduplica por idempotência).
//   • DESLIGADO POR PADRÃO: sem PLATFORM_EVENTS_URL + PLATFORM_EVENTS_SECRET
//     o enqueue é no-op (não acumula disco) — o bot de produção não muda.
//   • NUNCA loga payload (pode conter dados clínicos) — só ids/tipos/contagens.
//   • NUNCA lança: falha de outbox jamais derruba webhook ou /analisar.
// ─────────────────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const STATE_DIR = process.env.STATE_DIR || '/data';
const OUTBOX_PATH = path.join(STATE_DIR, 'anestbot2-outbox.json');

export function outboxConfig(env = process.env) {
  const url = env.PLATFORM_EVENTS_URL || '';
  const secret = env.PLATFORM_EVENTS_SECRET || '';
  return {
    url,
    secret,
    enabled: !!(url && secret),
    maxAttempts: Math.max(1, parseInt(env.OUTBOX_MAX_ATTEMPTS || '60', 10) || 60),
    sendTimeoutMs: Math.max(1000, parseInt(env.OUTBOX_SEND_TIMEOUT_MS || '10000', 10) || 10000),
  };
}

// ── persistência ────────────────────────────────────────────────────────────
let box = null; // { queue: [...], deadLetter: [...] }

function load() {
  try { box = JSON.parse(fs.readFileSync(OUTBOX_PATH, 'utf-8')); }
  catch { box = { queue: [], deadLetter: [] }; }
  if (!Array.isArray(box.queue)) box.queue = [];
  if (!Array.isArray(box.deadLetter)) box.deadLetter = [];
}
function save() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const tmp = OUTBOX_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(box));
    fs.renameSync(tmp, OUTBOX_PATH);
  } catch (e) { console.error('[events] falha ao salvar outbox (ignorado):', e.message); }
}
function ensureLoaded() { if (!box) load(); }

// Só para testes: força recarga do arquivo (simula restart do processo).
export function _reloadForTests() { box = null; ensureLoaded(); }
export function _resetForTests() {
  box = { queue: [], deadLetter: [] };
  try { fs.unlinkSync(OUTBOX_PATH); } catch { /* ok */ }
}

// ── envelope e assinatura (contrato: packages/contracts) ────────────────────
export function makeEnvelope(eventType, chatRef, payload, { correlationId, occurredAt } = {}) {
  return {
    event_id: crypto.randomUUID(),
    event_type: eventType,
    schema_version: 1,
    occurred_at: occurredAt || new Date().toISOString(),
    source: 'anestbot2',
    correlation_id: String(correlationId || chatRef).slice(0, 128),
    chat_ref: String(chatRef).slice(0, 128),
    payload: payload || {},
  };
}

export function signBody(secret, timestampS, rawBody) {
  return crypto.createHmac('sha256', secret).update(`${timestampS}.${rawBody}`).digest('hex');
}

export function buildHeaders(envelope, rawBody, secret, nowMs = Date.now()) {
  const ts = Math.floor(nowMs / 1000);
  return {
    'Content-Type': 'application/json',
    'X-Anestbot-Event-Id': envelope.event_id,
    'X-Anestbot-Timestamp': String(ts),
    'X-Anestbot-Signature': `v1=${signBody(secret, ts, rawBody)}`,
  };
}

// ── política de retry ───────────────────────────────────────────────────────
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_CAP_MS = 600_000; // 10 min

export function backoffMs(attempts, rand = Math.random) {
  const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
  const jitter = Math.floor(rand() * 0.3 * exp); // até +30% — evita rajadas sincronizadas
  return Math.min(BACKOFF_CAP_MS, exp + jitter);
}

// 2xx entregue · 408/429/5xx (e rede) retry · demais 4xx = contrato quebrado ⇒
// dead-letter imediata (reenviar o mesmo corpo nunca vai consertar um 400).
export function deliveryVerdict(status) {
  if (status >= 200 && status < 300) return 'delivered';
  if (status === 408 || status === 429) return 'retry';
  if (status >= 400 && status < 500) return 'dead';
  return 'retry';
}

// ── enfileirar ──────────────────────────────────────────────────────────────
export function enqueueEvent(eventType, chatRef, payload, opts = {}) {
  try {
    const cfg = opts.cfg || outboxConfig();
    if (!cfg.enabled) return null; // desligado: no-op absoluto
    ensureLoaded();
    const envelope = makeEnvelope(eventType, chatRef, payload, opts);
    box.queue.push({ envelope, attempts: 0, nextAt: 0, enqueuedAt: Date.now() });
    save();
    console.error(`[events] enfileirado ${eventType} id=${envelope.event_id} fila=${box.queue.length}`);
    schedulePump();
    return envelope.event_id;
  } catch (e) {
    console.error('[events] enqueue falhou (ignorado):', e.message);
    return null;
  }
}

// ── entrega ─────────────────────────────────────────────────────────────────
async function deliver(envelope, cfg, fetchImpl) {
  const rawBody = JSON.stringify(envelope);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.sendTimeoutMs);
  try {
    const res = await fetchImpl(cfg.url, {
      method: 'POST',
      signal: controller.signal,
      headers: buildHeaders(envelope, rawBody, cfg.secret),
      body: rawBody,
    });
    return { verdict: deliveryVerdict(res.status), status: res.status };
  } catch (e) {
    return { verdict: 'retry', status: 0, error: e.name === 'AbortError' ? `timeout (${cfg.sendTimeoutMs}ms)` : e.message };
  } finally {
    clearTimeout(timer);
  }
}

// Processa a CABEÇA da fila (FIFO estrito — nunca entrega fora de ordem).
// Devolve: 'idle' | 'waiting' | 'delivered' | 'retry' | 'dead'.
export async function processOutboxOnce({ cfg = outboxConfig(), fetchImpl = fetch, now = Date.now(), rand = Math.random } = {}) {
  if (!cfg.enabled) return 'idle';
  ensureLoaded();
  const head = box.queue[0];
  if (!head) return 'idle';
  if ((head.nextAt || 0) > now) return 'waiting';

  const { verdict, status, error } = await deliver(head.envelope, cfg, fetchImpl);
  if (verdict === 'delivered') {
    box.queue.shift();
    save();
    console.error(`[events] entregue ${head.envelope.event_type} id=${head.envelope.event_id} fila=${box.queue.length}`);
    return 'delivered';
  }
  head.attempts += 1;
  if (verdict === 'dead' || head.attempts >= cfg.maxAttempts) {
    box.queue.shift();
    head.deadAt = now;
    head.lastStatus = status;
    box.deadLetter.push(head);
    save();
    console.error(`[events] DEAD-LETTER ${head.envelope.event_type} id=${head.envelope.event_id} status=${status} attempts=${head.attempts} dead=${box.deadLetter.length}`);
    return 'dead';
  }
  head.nextAt = now + backoffMs(head.attempts, rand);
  save();
  console.error(`[events] retry ${head.envelope.event_type} id=${head.envelope.event_id} attempts=${head.attempts} status=${status || error}`);
  return 'retry';
}

// Replay manual seguro: devolve a dead-letter à fila com os MESMOS event_id
// (o receptor é idempotente — duplicata vira 200 sem reprocessar).
export function requeueDeadLetter() {
  ensureLoaded();
  const n = box.deadLetter.length;
  for (const item of box.deadLetter) {
    item.attempts = 0;
    item.nextAt = 0;
    delete item.deadAt;
    box.queue.push(item);
  }
  box.deadLetter = [];
  if (n) save();
  return n;
}

// Estatísticas agregadas SEM payload (para /diag e /fila).
export function outboxSnapshot() {
  ensureLoaded();
  const head = box.queue[0];
  return {
    enabled: outboxConfig().enabled,
    queued: box.queue.length,
    dead_letter: box.deadLetter.length,
    head_attempts: head ? head.attempts : 0,
    head_event_type: head ? head.envelope.event_type : null,
  };
}

// ── bomba (pump) em background ──────────────────────────────────────────────
const PUMP_INTERVAL_MS = 5_000;
let pumpTimer = null;
let pumping = false;

async function pumpLoop() {
  if (pumping) return;
  pumping = true;
  try {
    // Drena o que estiver pronto (teto por rodada para nunca monopolizar o loop).
    for (let i = 0; i < 20; i++) {
      const r = await processOutboxOnce();
      if (r !== 'delivered' && r !== 'dead') break;
    }
  } catch (e) {
    console.error('[events] pump falhou (ignorado):', e.message);
  } finally {
    pumping = false;
  }
}

function schedulePump() {
  if (pumpTimer) return;
  pumpTimer = setInterval(pumpLoop, PUMP_INTERVAL_MS);
  if (pumpTimer.unref) pumpTimer.unref(); // nunca impede o processo de sair
}

export function startOutboxPump() {
  const cfg = outboxConfig();
  if (!cfg.enabled) {
    if (cfg.url || cfg.secret) {
      console.warn('⚠️  Outbox PARCIALMENTE configurado (PLATFORM_EVENTS_URL e PLATFORM_EVENTS_SECRET precisam existir juntos) — eventos DESLIGADOS.');
    }
    return false;
  }
  ensureLoaded();
  if (box.queue.length) console.error(`[events] ${box.queue.length} evento(s) pendente(s) no outbox — retomando entrega`);
  schedulePump();
  return true;
}
