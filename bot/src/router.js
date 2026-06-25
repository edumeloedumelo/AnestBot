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

  const chatId = m.from;
  if (!isAllowed(chatId)) return;

  // Cacheia mídia recebida para uso no /analisar (GET API não retorna URLs de mídia).
  // Cacheia mesmo se fromMe — o médico/secretária podem enviar pelo número conectado.
  if ((m.type === 'image' || m.type === 'document') && m.media) {
    cacheMediaById(m.id, { url: m.media, caption: (m.body || ''), type: m.type });
    console.log('[router] mídia cacheada id:', m.id, 'url:', String(m.media).substring(0, 80));
  }

  // Comandos (ex: /analisar) são processados mesmo se fromMe — o bot nunca
  // gera mensagens iniciadas em "/", então não há risco de auto-loop.
  const body = (m.body || '').trim();
  if (m.type === 'chat' && isCommand(body)) {
    await handleCommand(chatId, body, m);
  }
}
