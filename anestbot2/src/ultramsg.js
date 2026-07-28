// Envio de mensagens de texto pela API UltraMsg (com quebra em pedaços seguros).
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

export async function sendText(to, body) {
  if (!body) return;
  for (const chunk of splitMessage(body)) {
    try {
      const res = await fetch(`${BASE}/messages/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: TOKEN, to, body: chunk }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) console.error('[ultramsg] send error', res.status, JSON.stringify(data));
    } catch (e) {
      console.error('[ultramsg] falha no envio:', e.message);
    }
  }
}
