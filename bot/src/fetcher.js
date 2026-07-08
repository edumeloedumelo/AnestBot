// Busca mensagens do grupo via GET UltraMsg e filtra apenas as novas.
const INSTANCE = process.env.ULTRAMSG_INSTANCE_ID;
const TOKEN = process.env.ULTRAMSG_TOKEN;
const BASE = `https://api.ultramsg.com/${INSTANCE}`;

const FETCH_LIMIT = 500;
// Janela de retroatividade: busca N segundos ANTES de lastTime para capturar anamneses
// enviadas pouco antes do último /analisar. Configurável via LOOKBACK_SECONDS (padrão: 1h).
const LOOKBACK_SECONDS = parseInt(process.env.LOOKBACK_SECONDS || '3600', 10);

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

  // Aplica janela de retroatividade para não perder anamneses enviadas antes do
  // último /analisar (ex: usuário enviou anamnese, rodou /analisar parcialmente,
  // depois enviou exames e separador). Sem retroatividade, a anamnese ficaria
  // "atrás" do lastTime e o caso seria ignorado.
  // O parser usa _alreadyAnalyzed para evitar reanálise dos casos antigos
  // que também entrem nessa janela.
  const effectiveAfter = afterTimestamp > 0
    ? Math.max(0, afterTimestamp - LOOKBACK_SECONDS)
    : 0;

  const filtered = msgs
    .filter((m) => getTime(m) > effectiveAfter)
    .sort((a, b) => getTime(a) - getTime(b));

  console.error(`[fetcher] chatId=${chatId} lastTime=${afterTimestamp} effectiveAfter=${effectiveAfter} total=${msgs.length} filtered=${filtered.length}`);

  return filtered;
}
