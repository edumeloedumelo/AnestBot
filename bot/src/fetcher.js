// Busca mensagens do grupo via GET UltraMsg e filtra apenas as novas.
const INSTANCE = process.env.ULTRAMSG_INSTANCE_ID;
const TOKEN = process.env.ULTRAMSG_TOKEN;
const BASE = `https://api.ultramsg.com/${INSTANCE}`;

const FETCH_LIMIT = 500;

// UltraMsg pode usar "timestamp" ou "time" dependendo do endpoint — normaliza.
function getTime(m) {
  return m.timestamp || m.time || 0;
}

// fromMe pode vir como bool ou string "true"
function isFromMe(m) {
  return m.fromMe === true || m.fromMe === 'true' || m.self === true;
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
  console.log('[fetcher] raw response type:', typeof data, Array.isArray(data) ? 'array len=' + data.length : JSON.stringify(data).substring(0, 200));

  const msgs = Array.isArray(data) ? data : (data?.messages ?? []);
  console.log(`[fetcher] total msgs: ${msgs.length}, afterTimestamp: ${afterTimestamp}`);

  if (msgs.length > 0) {
    const sample = msgs[0];
    console.log('[fetcher] sample msg keys:', Object.keys(sample).join(', '));
    console.log('[fetcher] sample time/timestamp:', sample.time, sample.timestamp, 'fromMe:', sample.fromMe);
  }

  const filtered = msgs
    .filter((m) => !isFromMe(m) && getTime(m) > afterTimestamp)
    .sort((a, b) => getTime(a) - getTime(b));

  console.log(`[fetcher] filtered msgs: ${filtered.length}`);
  return filtered;
}
