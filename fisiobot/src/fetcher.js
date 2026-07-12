const INSTANCE = process.env.ULTRAMSG_INSTANCE_ID;
const TOKEN = process.env.ULTRAMSG_TOKEN;
const BASE = `https://api.ultramsg.com/${INSTANCE}`;
const FETCH_LIMIT = 500;
const LOOKBACK_SECONDS = parseInt(process.env.LOOKBACK_SECONDS || '3600', 10);

function getTime(m) { return m.timestamp || m.time || 0; }

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

  const effectiveAfter = afterTimestamp > 0
    ? Math.max(0, afterTimestamp - LOOKBACK_SECONDS)
    : 0;

  const filtered = msgs
    .filter((m) => getTime(m) > effectiveAfter)
    .sort((a, b) => getTime(a) - getTime(b));

  console.error(`[fetcher] chatId=${chatId} lastTime=${afterTimestamp} effectiveAfter=${effectiveAfter} total=${msgs.length} filtered=${filtered.length}`);
  return filtered;
}
