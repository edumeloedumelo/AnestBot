// Cliente da API UltraMsg: envio de texto e download de mídia recebida.
const INSTANCE = process.env.ULTRAMSG_INSTANCE_ID;
const TOKEN = process.env.ULTRAMSG_TOKEN;
const BASE = `https://api.ultramsg.com/${INSTANCE}`;

// WhatsApp aceita ~65k mas mensagens longas falham/cortam; mantemos pedaços seguros.
const MAX_LEN = 4000;

export async function sendText(to, body) {
  if (!body) return;
  const chunks = splitMessage(body, MAX_LEN);
  for (const chunk of chunks) {
    const res = await fetch(`${BASE}/messages/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: TOKEN, to, body: chunk }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) {
      console.error('[ultramsg] send error', res.status, JSON.stringify(data));
    }
  }
}

// Quebra texto respeitando, na medida do possível, quebras de linha.
export function splitMessage(text, max = MAX_LEN) {
  if (text.length <= max) return [text];
  const out = [];
  let buf = '';
  for (const line of text.split('\n')) {
    if ((buf + '\n' + line).length > max) {
      if (buf) out.push(buf);
      if (line.length > max) {
        // linha gigante: corta no braço
        for (let i = 0; i < line.length; i += max) out.push(line.slice(i, i + max));
        buf = '';
      } else {
        buf = line;
      }
    } else {
      buf = buf ? buf + '\n' + line : line;
    }
  }
  if (buf) out.push(buf);
  return out;
}

// Baixa a mídia (imagem/pdf) de uma URL e devolve bloco pronto p/ Claude.
export async function downloadMediaBlock(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download falhou (${res.status})`);
  const contentType = res.headers.get('content-type') || '';
  const buffer = await res.arrayBuffer();
  const base64Data = bufferToBase64(buffer);

  if (contentType.startsWith('image/')) {
    const mediaType = contentType.includes('png') ? 'image/png'
      : contentType.includes('webp') ? 'image/webp'
      : contentType.includes('gif') ? 'image/gif'
      : 'image/jpeg';
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } };
  }
  if (contentType === 'application/pdf' || url.toLowerCase().includes('.pdf')) {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } };
  }
  // fallback: tenta como texto
  const textContent = new TextDecoder().decode(buffer).substring(0, 10000);
  return { type: 'text', text: `### ARQUIVO ENVIADO\n${textContent}` };
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
