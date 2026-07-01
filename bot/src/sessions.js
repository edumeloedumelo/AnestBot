// Buffer em memória por tenant+chat: acumula as mensagens (texto/mídia) conforme
// chegam pelo webhook, na ordem em que chegaram, até o comando de análise as
// consumir.
const sessions = new Map();
const TTL_MS = 6 * 60 * 60 * 1000; // limpa sessões inativas após 6h

function key(tenantId, chatId) {
  return `${tenantId}:${chatId}`;
}

function get(tenantId, chatId) {
  const k = key(tenantId, chatId);
  let s = sessions.get(k);
  if (!s) {
    s = { messages: [], updatedAt: Date.now() };
    sessions.set(k, s);
  }
  s.updatedAt = Date.now();
  return s;
}

export function addMessage(tenantId, chatId, message) {
  get(tenantId, chatId).messages.push(message);
}

export function snapshot(tenantId, chatId) {
  return [...get(tenantId, chatId).messages];
}

export function clear(tenantId, chatId) {
  sessions.delete(key(tenantId, chatId));
}

// Cada webhook chega como uma requisição HTTP independente e é processado sem
// esperar a resposta (pra devolver 200 rápido pra UltraMsg) — sem serialização,
// duas mensagens do mesmo chat podem terminar de processar fora de ordem (ex: o
// /analisar rodando antes de uma imagem anterior terminar de entrar no buffer).
// Isso encadeia o processamento por chat numa fila, preservando a ordem de
// chegada mesmo com processamento assíncrono concorrente.
const queues = new Map();

export function runSerialized(tenantId, chatId, fn) {
  const k = key(tenantId, chatId);
  const previous = queues.get(k) || Promise.resolve();
  const next = previous.then(fn, fn);
  queues.set(k, next.catch(() => {}));
  return next;
}

// limpeza periódica de sessões abandonadas
setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) {
    if (now - s.updatedAt > TTL_MS) sessions.delete(k);
  }
}, 30 * 60 * 1000).unref?.();
