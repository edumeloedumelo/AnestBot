import { isCommand, handleCommand } from './commands.js';
import { saveMedia } from './mediastore.js';

const ALLOWED = (process.env.ALLOWED_CHATS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

function isAllowed(chatId) {
  if (ALLOWED.length === 0) return true;
  return ALLOWED.includes(chatId);
}

export async function handleWebhook(payload) {
  if (!payload) return;

  const et = payload.event_type;
  const isMsg = !et || et === 'message_received' || et === 'message_create' || et === 'message_created';
  if (!isMsg) {
    console.log('[router] ignorando event_type:', et);
    return;
  }

  const m = payload.data;
  if (!m) return;

  const chatId = m.from;
  if (!isAllowed(chatId)) return;

  // Persiste URL de mídia recebida via webhook (contratos, PDFs, imagens de documentos)
  if ((m.type === 'image' || m.type === 'document') && m.media) {
    saveMedia(m.id, { url: m.media, caption: m.body || '', type: m.type });
  }

  const body = (m.body || '').trim();
  if (m.type === 'chat' && isCommand(body)) {
    await handleCommand(chatId, body, m);
  }
}
