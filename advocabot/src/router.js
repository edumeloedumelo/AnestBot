import { isCommand, handleCommand, doAnalisar } from './commands.js';
import { saveMedia } from './mediastore.js';
import { sendText } from './ultramsg.js';
import { START_CASE_RE, FINISH_CASE_RE } from './parser.js';

const ALLOWED = (process.env.ALLOWED_CHATS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

// Por padrão o bot só atua em grupos (@g.us). Defina GROUPS_ONLY=false para liberar DMs.
const GROUPS_ONLY = (process.env.GROUPS_ONLY ?? 'true').toLowerCase() !== 'false';

function isAllowed(chatId) {
  if (GROUPS_ONLY && !String(chatId).endsWith('@g.us')) return false;
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
  if (m.type !== 'chat') return;

  if (isCommand(body)) {
    await handleCommand(chatId, body, m);
    return;
  }

  // Protocolo start case / finish case
  // (respostas do bot nunca casam com os gatilhos — sem risco de loop)
  if (FINISH_CASE_RE.test(body)) {
    await doAnalisar(chatId, m);
    return;
  }

  if (START_CASE_RE.test(body)) {
    await sendText(chatId,
      '📂 Caso iniciado.\n\nEnvie a descrição do caso, documentos, PDFs e imagens.\n' +
      'Quando terminar, envie *finish case* — a análise começa automaticamente.');
  }
}
