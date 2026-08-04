// Envio de mensagens de texto pela API UltraMsg (com quebra em pedaços seguros).
import { recordBotText } from './store.js';

const INSTANCE = process.env.ULTRAMSG_INSTANCE_ID;
const TOKEN = process.env.ULTRAMSG_TOKEN;
const BASE = `https://api.ultramsg.com/${INSTANCE}`;
const MAX_LEN = 4000;

export function splitMessage(text, max = MAX_LEN) {
  if (!text) return [];
  if (text.length <= max) return [text];
  const out = [];
  let buf = '';
  for (const line of text.split('\n')) {
    if ((buf + '\n' + line).length > max) {
      if (buf) out.push(buf);
      if (line.length > max) { for (let i = 0; i < line.length; i += max) out.push(line.slice(i, i + max)); buf = ''; }
      else buf = line;
    } else {
      buf = buf ? buf + '\n' + line : line;
    }
  }
  if (buf) out.push(buf);
  return out;
}

const SEND_TIMEOUT_MS = 20_000;

export async function sendText(to, body) {
  // Nunca silencioso: um laudo vazio (ex.: format.js removeu tudo ou a API
  // devolveu '') deixaria o grupo sem resposta e sem pista nos logs.
  if (!body) { console.error(`[ultramsg] corpo VAZIO — nada enviado para ${to}`); return; }
  for (const chunk of splitMessage(body)) {
    recordBotText(to, chunk); // p/ reconhecer o eco no webhook e não poluir casos
    // Timeout: sem isso, a API da UltraMsg travando prende para sempre o
    // fluxo do /analisar (e o lock do grupo) que está aguardando este envio.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE}/messages/chat`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: TOKEN, to, body: chunk }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) console.error('[ultramsg] send error', res.status, JSON.stringify(data));
    } catch (e) {
      console.error('[ultramsg] falha no envio:', e.name === 'AbortError' ? `timeout (${SEND_TIMEOUT_MS / 1000}s)` : e.message);
    } finally {
      clearTimeout(timer);
    }
  }
}
