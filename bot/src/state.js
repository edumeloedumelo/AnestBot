// Persiste a posição de leitura e os IDs de mensagens já analisadas por grupo.
// Grava em /data por padrão (sobrescrito por STATE_DIR se definido).
// IMPORTANTE: para não perder estado entre deploys, monte um volume Railway em /data.
import fs from 'fs';
import path from 'path';

const STATE_DIR = process.env.STATE_DIR || '/data';
const STATE_PATH = path.join(STATE_DIR, 'state.json');

// Máximo de IDs de mensagens já processadas guardados por grupo (evita crescimento infinito).
const MAX_PROCESSED_IDS = 3000;

function load() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

// Escrita ATÔMICA e protegida: grava em .tmp e renomeia. Nunca lança (não derruba o processo).
function save(data) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  } catch { /* já existe */ }
  try {
    const tmp = STATE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, STATE_PATH);
  } catch (e) {
    console.error('[state] falha ao salvar (ignorado para não derrubar o processo):', e.message);
  }
}

function entry(data, chatId) {
  if (!data[chatId]) data[chatId] = { lastTime: 0, processed: [] };
  if (!Array.isArray(data[chatId].processed)) data[chatId].processed = [];
  return data[chatId];
}

// Unix timestamp (segundos) do último corte de análise no grupo. 0 = nunca analisou.
export function getLastTime(chatId) {
  return load()[chatId]?.lastTime ?? 0;
}

export function setLastTime(chatId, timestamp) {
  const data = load();
  entry(data, chatId).lastTime = timestamp;
  save(data);
}

// Conjunto de IDs de mensagens já analisadas (dedup durável — imune a texto/ordem/fetch).
export function getProcessed(chatId) {
  return new Set(load()[chatId]?.processed ?? []);
}

// Marca IDs de mensagens como já analisados (mantém apenas os mais recentes).
export function markProcessed(chatId, ids) {
  if (!ids || ids.length === 0) return;
  const data = load();
  const e = entry(data, chatId);
  const merged = e.processed.concat(ids.filter(Boolean));
  // Mantém só os últimos MAX_PROCESSED_IDS (dedup por Set preservando ordem de inserção).
  const unique = [...new Set(merged)];
  e.processed = unique.slice(-MAX_PROCESSED_IDS);
  save(data);
}

export function resetGroup(chatId) {
  const data = load();
  delete data[chatId];
  save(data);
}
