// Recebe o payload do webhook UltraMsg e processa comandos + cacheia mídias recebidas.
import { isCommand, handleCommand } from './commands.js';
import { cacheMediaById } from './sessions.js';

const ALLOWED = (process.env.ALLOWED_CHATS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isAllowed(chatId) {
  if (ALLOWED.length === 0) return true;
  return ALLOWED.includes(chatId);
}

export async function handleWebhook(payload) {
  // UltraMsg may send event_type or just omit it on some versions — be permissive
  if (!payload) return;
  const isMessageEvent = !payload.event_type || payload.event_type === 'message_received';
  if (!isMessageEvent) {
    console.log('[router] ignoring event_type:', payload.event_type);
    return;
  }
  const m = payload.data;
  if (!m) return;
  if (m.fromMe || m.self) return; // ignora mensagens do próprio bot

  const chatId = m.from;
  if (!isAllowed(chatId)) return;

  // Cacheia mídia recebida para uso no /analisar (GET API não retorna URLs de mídia)
  if ((m.type === 'image' || m.type === 'document') && m.media) {
    cacheMediaById(m.id, { url: m.media, caption: (m.body || ''), type: m.type });
    console.log('[router] mídia cacheada id:', m.id, 'url:', String(m.media).substring(0, 80));
  }

  const body = (m.body || '').trim();
  if (m.type === 'chat' && isCommand(body)) {
    await handleCommand(chatId, body, m);
  }
}
