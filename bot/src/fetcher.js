// Busca mensagens do grupo via GET UltraMsg e filtra apenas as novas.
const INSTANCE = process.env.ULTRAMSG_INSTANCE_ID;
const TOKEN = process.env.ULTRAMSG_TOKEN;
const BASE = `https://api.ultramsg.com/${INSTANCE}`;

// Quantidade máxima de mensagens a buscar por chamada.
// 500 é conservador; ajuste se os grupos tiverem histórico muito longo.
const FETCH_LIMIT = 500;

/**
 * Retorna mensagens do grupo mais recentes que `afterTimestamp` (Unix seg).
 * Cada item: { id, type, body, media, time, fromMe, author }
 */
export async function fetchNewMessages(chatId, afterTimestamp = 0) {
  const url = new URL(`${BASE}/chats/messages`);
  url.searchParams.set('token', TOKEN);
  url.searchParams.set('chatId', chatId);
  url.searchParams.set('limit', String(FETCH_LIMIT));

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`UltraMsg GET messages ${res.status}: ${body.substring(0, 200)}`);
  }

  const data = await res.json();
  const msgs = Array.isArray(data) ? data : (data?.messages ?? []);

  // Filtra mensagens do bot (fromMe) e anteriores ao ponto de corte.
  // UltraMsg retorna do mais recente para o mais antigo — invertemos para ordem cronológica.
  const filtered = msgs
    .filter((m) => !m.fromMe && m.time > afterTimestamp)
    .sort((a, b) => a.time - b.time);

  return filtered;
}
