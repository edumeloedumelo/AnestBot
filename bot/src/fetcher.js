// Busca mensagens do grupo via GET UltraMsg e filtra apenas as novas.
const INSTANCE = process.env.ULTRAMSG_INSTANCE_ID;
const TOKEN = process.env.ULTRAMSG_TOKEN;
const BASE = `https://api.ultramsg.com/${INSTANCE}`;

const FETCH_LIMIT = 500;

// UltraMsg pode usar "timestamp" ou "time" dependendo do endpoint — normaliza.
function getTime(m) {
  return m.timestamp || m.time || 0;
}

export async function fetchNewMessages(chatId, afterTimestamp = 0) {
  const url = new URL(`${BASE}/chats/messages`);
  url.searchParams.set('token', TOKEN);
  url.searchParams.set('chatId', chatId);
  url.searchParams.set('limit', String(FETCH_LIMIT));

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`UltraMsg GET messages ${res.status}: ${body.substring(0, 300)}`);
  }

  const data = await res.json();
  const msgs = Array.isArray(data) ? data : (data?.messages ?? []);

  // Preservamos fromMe: o parser usa fromMe=true para ignorar respostas do bot.
  // Filtramos apenas por timestamp.
  const filtered = msgs
    .filter((m) => getTime(m) > afterTimestamp)
    .sort((a, b) => getTime(a) - getTime(b));

  return filtered;
}
