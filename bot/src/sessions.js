// Buffer em memória por chat: acumula mídias e textos até o comando de análise.
const sessions = new Map();
const TTL_MS = 6 * 60 * 60 * 1000; // limpa sessões inativas após 6h

function get(chatId) {
  let s = sessions.get(chatId);
  if (!s) {
    s = { media: [], texts: [], updatedAt: Date.now() };
    sessions.set(chatId, s);
  }
  s.updatedAt = Date.now();
  return s;
}

export function addMedia(chatId, item) {
  get(chatId).media.push(item);
}

export function addText(chatId, text) {
  get(chatId).texts.push(text);
}

export function snapshot(chatId) {
  const s = get(chatId);
  return { media: [...s.media], texts: [...s.texts] };
}

export function clear(chatId) {
  sessions.delete(chatId);
}

// Cache de mídia por ID de mensagem (populado pelo webhook quando Download Media está ON)
const mediaCache = new Map(); // msgId -> { url, caption, type }

export function cacheMediaById(msgId, item) {
  mediaCache.set(msgId, item);
}

export function getMediaById(msgId) {
  return mediaCache.get(msgId);
}

// limpeza periódica
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.updatedAt > TTL_MS) sessions.delete(id);
  }
}, 30 * 60 * 1000).unref?.();
