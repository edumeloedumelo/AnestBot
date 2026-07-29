// ─────────────────────────────────────────────────────────────────────────
// STORE — coração da arquitetura webhook-first.
//
// Toda mensagem (texto E mídia) é gravada AQUI em tempo real quando chega pelo
// webhook. O /analisar lê SOMENTE deste store — nunca do GET /chats/messages da
// UltraMsg (que truncava o texto de cards longos, a causa raiz da 1.0).
//
// Persistido em /data (volume Railway) com escrita atômica. Nunca lança.
// ─────────────────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';

const STATE_DIR = process.env.STATE_DIR || '/data';
const STORE_PATH = path.join(STATE_DIR, 'anestbot2-store.json');

// Limites para o armazenamento não crescer infinito.
const MAX_MESSAGES_PER_CHAT = 800;   // mensagens recentes guardadas por grupo
const MAX_PROCESSED_IDS = 4000;      // ids de mensagens já analisadas por grupo
const MAX_RECENT_CASES = 30;         // casos recentes p/ retry cirúrgico (/resetar)

let db = {};
let seqCounter = 0; // ordenação estável; semeado no load p/ ser monotônico entre restarts

function load() {
  try { db = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8')); }
  catch { db = {}; }
  // Semeia o contador com o maior _seq já existente (sobrevive a reinícios).
  let mx = 0;
  for (const c of Object.values(db)) {
    for (const m of (c?.messages || [])) if (typeof m._seq === 'number' && m._seq > mx) mx = m._seq;
  }
  seqCounter = mx + 1;
}

function save() {
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); } catch { /* já existe */ }
  try {
    const tmp = STORE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, STORE_PATH);
  } catch (e) {
    console.error('[store] falha ao salvar (ignorado):', e.message);
  }
}

load();

function chat(chatId) {
  if (!db[chatId]) db[chatId] = { messages: [], processed: [], recentCases: [] };
  const c = db[chatId];
  if (!Array.isArray(c.messages)) c.messages = [];
  if (!Array.isArray(c.processed)) c.processed = [];
  if (!Array.isArray(c.recentCases)) c.recentCases = [];
  return c;
}

// Estado do "portão" de captura: true = há um caso aberto (xxxx sem ❌❌❌❌).
// Persistente — sobrevive a restarts/redeploys no meio de um caso.
export function isCaseOpen(chatId) {
  return !!db[chatId]?.caseOpen;
}
export function setCaseOpen(chatId, open) {
  const c = chat(chatId);
  if (!!c.caseOpen === !!open) return;
  c.caseOpen = !!open;
  save();
}

// Grava uma mensagem normalizada. Deduplica por id (o webhook pode reenviar).
// Atualiza a mensagem se ela já existe (ex.: mídia que chega depois do texto).
export function appendMessage(chatId, msg) {
  if (!chatId || !msg || !msg.id) return;
  const c = chat(chatId);
  const idx = c.messages.findIndex((m) => m.id === msg.id);
  if (idx >= 0) {
    // Mescla: preserva campos existentes E o _seq original (não reordena a
    // mensagem quando a mídia chega depois do texto com o mesmo id).
    const keepSeq = c.messages[idx]._seq;
    c.messages[idx] = { ...c.messages[idx], ...pruneEmpty(msg), _seq: keepSeq };
  } else {
    // O store atribui o _seq (fonte única) — ignora qualquer _seq do chamador.
    c.messages.push({ ...msg, _seq: seqCounter++ });
    if (c.messages.length > MAX_MESSAGES_PER_CHAT) {
      c.messages = c.messages.slice(-MAX_MESSAGES_PER_CHAT);
    }
  }
  save();
}

function pruneEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

// Todas as mensagens do grupo, ordenadas por timestamp (asc), com desempate estável.
export function getMessages(chatId) {
  const c = db[chatId];
  if (!c || !Array.isArray(c.messages)) return [];
  // Guardas ?? 0 evitam comparador NaN em mensagens legadas sem timestamp/_seq.
  return [...c.messages].sort((a, b) => ((a.timestamp || 0) - (b.timestamp || 0)) || ((a._seq ?? 0) - (b._seq ?? 0)));
}

// Dedup durável: ids de mensagens já analisadas.
export function getProcessed(chatId) {
  return new Set(db[chatId]?.processed ?? []);
}

export function markProcessed(chatId, ids) {
  if (!ids || ids.length === 0) return;
  const c = chat(chatId);
  const merged = [...new Set(c.processed.concat(ids.filter(Boolean)))];
  c.processed = merged.slice(-MAX_PROCESSED_IDS);
  save();
}

// Registra um caso analisado (para retry cirúrgico via /resetar).
export function recordCase(chatId, { msgIds, patientName }) {
  if (!msgIds || msgIds.length === 0) return;
  const c = chat(chatId);
  c.recentCases.push({ msgIds, patientName: patientName || '' });
  c.recentCases = c.recentCases.slice(-MAX_RECENT_CASES);
  save();
}

// /resetar — reabre APENAS os N casos mais recentes (remove seus ids do dedup),
// sem tocar no restante do histórico. Casos antigos permanecem protegidos.
export function retryRecentCases(chatId, n = 1) {
  const c = chat(chatId);
  const targets = c.recentCases.slice(-n);
  if (targets.length === 0) return { retried: 0, patientNames: [] };
  const ids = new Set(targets.flatMap((t) => t.msgIds));
  c.processed = c.processed.filter((id) => !ids.has(id));
  c.recentCases = c.recentCases.slice(0, c.recentCases.length - targets.length);
  save();
  return { retried: targets.length, patientNames: targets.map((t) => t.patientName).filter(Boolean) };
}

// Verificação/correção automática do estado do grupo (chamada pelo /resetar).
// Corrige apenas problemas SEGUROS de corrigir; devolve a lista do que foi feito.
export function selfHealChat(chatId) {
  const fixes = [];
  const c = db[chatId];
  if (!c) return fixes;

  // Estruturas ausentes/corrompidas → recria.
  for (const k of ['messages', 'processed', 'recentCases']) {
    if (!Array.isArray(c[k])) { c[k] = []; fixes.push(`Estrutura "${k}" corrompida — recriada`); }
  }

  // Mensagens sem id não podem ser deduplicadas → remove.
  const before = c.messages.length;
  c.messages = c.messages.filter((m) => m && m.id);
  if (c.messages.length < before) fixes.push(`${before - c.messages.length} mensagem(ns) sem id removida(s)`);

  // Ids duplicados → mantém a mais completa (a de maior corpo/mídia).
  const byId = new Map();
  for (const m of c.messages) {
    const prev = byId.get(m.id);
    if (!prev) { byId.set(m.id, m); continue; }
    const score = (x) => (x.body || '').length + (x.mediaUrl ? 1000 : 0);
    byId.set(m.id, score(m) >= score(prev) ? { ...prev, ...m, _seq: prev._seq } : prev);
  }
  if (byId.size < c.messages.length) {
    fixes.push(`${c.messages.length - byId.size} mensagem(ns) duplicada(s) mescladas`);
    c.messages = [...byId.values()];
  }

  // Timestamps inválidos (NaN/negativos) quebram a ordenação → herda o timestamp
  // da mensagem anterior (em ordem de chegada/_seq), preservando a posição.
  let badTs = 0;
  let lastGood = 0;
  for (const m of [...c.messages].sort((a, b) => (a._seq ?? 0) - (b._seq ?? 0))) {
    if (typeof m.timestamp !== 'number' || !isFinite(m.timestamp) || m.timestamp < 0) { m.timestamp = lastGood; badTs++; }
    else lastGood = m.timestamp;
  }
  if (badTs) fixes.push(`${badTs} timestamp(s) inválido(s) corrigido(s)`);

  // Ids de processed inválidos → remove.
  const pBefore = c.processed.length;
  c.processed = c.processed.filter((id) => typeof id === 'string' && id);
  if (c.processed.length < pBefore) fixes.push(`${pBefore - c.processed.length} id(s) inválido(s) removido(s) do dedup`);

  if (fixes.length) save();
  return fixes;
}

// /resetartudo — apaga TODO o estado do grupo (histórico + dedup).
export function resetChat(chatId) {
  delete db[chatId];
  save();
}

// Timestamp da mensagem mais recente do grupo (para /status).
export function lastMessageTime(chatId) {
  const msgs = db[chatId]?.messages ?? [];
  return msgs.reduce((mx, m) => Math.max(mx, m.timestamp || 0), 0);
}
