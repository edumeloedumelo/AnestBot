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
