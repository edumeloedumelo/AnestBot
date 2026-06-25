// Recebe o payload do webhook UltraMsg e processa comandos + cacheia mídias recebidas.
import { isCommand, handleCommand } from './commands.js';
import { saveMedia } from './mediastore.js';

const ALLOWED = (process.env.ALLOWED_CHATS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isAllowed(chatId) {
  if (ALLOWED.length === 0) return true;
  return ALLOWED.includes(chatId);
}

export async function handleWebhook(payload) {
  if (!payload) return;

  // Aceita message_received (de outros) e message_create (do próprio número conectado).
  // Isso permite que o médico dispare /analisar do número do WhatsApp Business.
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

  // Persiste URL de mídia recebida (GET API não retorna URLs de mídia).
  // "Webhook Download Media: ON" no UltraMsg é obrigatório para m.media ter valor.
  if ((m.type === 'image' || m.type === 'document') && m.media) {
    saveMedia(m.id, { url: m.media, caption: m.body || '', type: m.type });
  }

  // Processa comandos (/analisar etc.) de qualquer remetente — inclusive o número
  // conectado. O bot nunca envia mensagens começando com "/", sem risco de loop.
  const body = (m.body || '').trim();
  if (m.type === 'chat' && isCommand(body)) {
    await handleCommand(chatId, body, m);
  }
}
