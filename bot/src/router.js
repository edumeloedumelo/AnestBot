// Recebe o payload do webhook UltraMsg e despacha (buffer de mídia ou comando).
import * as session from './sessions.js';
import { isCommand, handleCommand } from './commands.js';

const ALLOWED = (process.env.ALLOWED_CHATS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isAllowed(chatId) {
  if (ALLOWED.length === 0) return true;
  return ALLOWED.includes(chatId);
}

export async function handleWebhook(payload) {
  if (!payload || payload.event_type !== 'message_received') return;
  const m = payload.data;
  if (!m) return;
  if (m.fromMe || m.self) return; // ignora mensagens do próprio bot

  const chatId = m.from; // grupo (@g.us) ou contato (@c.us); serve para responder
  if (!isAllowed(chatId)) return;

  const body = (m.body || '').trim();

  // Mídia: imagem ou documento (PDF) -> entra no buffer
  if ((m.type === 'image' || m.type === 'document') && m.media) {
    session.addMedia(chatId, { url: m.media, caption: body, type: m.type });
    if (body && !isCommand(body)) session.addText(chatId, body); // legenda vira contexto
    return;
  }

  // Texto
  if (m.type === 'chat') {
    if (isCommand(body)) {
      await handleCommand(chatId, body, m);
      return;
    }
    if (body) session.addText(chatId, body); // texto solto vira contexto/anamnese
    return;
  }
}
