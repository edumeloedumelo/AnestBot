// Persiste a posição de leitura e os IDs de mensagens já analisadas por grupo.
// Grava em /data por padrão (sobrescrito por STATE_DIR se definido).
// IMPORTANTE: para não perder estado entre deploys, monte um volume Railway em /data.
import fs from 'fs';
import path from 'path';

const STATE_DIR = process.env.STATE_DIR || '/data';
const STATE_PATH = path.join(STATE_DIR, 'state.json');

// Máximo de IDs de mensagens já processadas guardados por grupo (evita crescimento infinito).
const MAX_PROCESSED_IDS = 3000;

// Quantos dos últimos casos analisados guardamos para permitir "corrigir" (retry
// cirúrgico) sem reler o histórico inteiro do grupo.
const MAX_RECENT_CASES = 20;

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
  if (!data[chatId]) data[chatId] = { lastTime: 0, processed: [], recentCases: [] };
  if (!Array.isArray(data[chatId].processed)) data[chatId].processed = [];
  if (!Array.isArray(data[chatId].recentCases)) data[chatId].recentCases = [];
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

// Registra um caso recém-analisado (para permitir retry cirúrgico via /resetar).
// Guarda apenas os últimos MAX_RECENT_CASES — não é o histórico completo do grupo.
export function recordCase(chatId, { msgIds, minTime, maxTime, patientName }) {
  if (!msgIds || msgIds.length === 0) return;
  const data = load();
  const e = entry(data, chatId);
  e.recentCases.push({ msgIds, minTime, maxTime, patientName: patientName || '' });
  e.recentCases = e.recentCases.slice(-MAX_RECENT_CASES);
  save(data);
}

// RETRY CIRÚRGICO (regra absoluta): reabre apenas os N casos mais recentes para
// reanálise — NUNCA o histórico inteiro do grupo. Remove os IDs desses casos do
// dedup e recua o corte de leitura só o suficiente para incluí-los de novo.
// Casos mais antigos que esses continuam protegidos (dedup intacto para eles).
export function retryRecentCases(chatId, n = 1) {
  const data = load();
  const e = entry(data, chatId);
  const targets = e.recentCases.slice(-n);
  if (targets.length === 0) {
    return { retried: 0, patientNames: [] };
  }

  const targetIds = new Set(targets.flatMap(c => c.msgIds));
  e.processed = e.processed.filter(id => !targetIds.has(id));

  const minTimeAcrossTargets = Math.min(...targets.map(c => c.minTime).filter(t => t > 0));
  if (Number.isFinite(minTimeAcrossTargets) && minTimeAcrossTargets > 0) {
    e.lastTime = Math.min(e.lastTime, minTimeAcrossTargets - 1);
  }

  // Remove os casos-alvo da lista de recentes (serão regravados quando reanalisados).
  e.recentCases = e.recentCases.slice(0, e.recentCases.length - targets.length);

  save(data);
  return {
    retried: targets.length,
    patientNames: targets.map(c => c.patientName).filter(Boolean),
  };
}

// RESET TOTAL (perigoso): apaga TODO o estado do grupo — o bot vai reler e
// reavaliar TODO o histórico disponível na próxima análise. Use apenas em
// emergências reais (nunca para corrigir um caso específico — para isso,
// use retryRecentCases via /resetar).
export function resetGroup(chatId) {
  const data = load();
  delete data[chatId];
  save(data);
}
