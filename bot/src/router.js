// Recebe o payload do webhook UltraMsg e processa comandos + cacheia mídias e textos recebidos.
import { isCommand, handleCommand } from './commands.js';
import { saveMedia, saveText } from './mediastore.js';
import { getMessageBody } from './parser.js';

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
  if (m.type === 'image' || m.type === 'document') {
    if (m.media) {
      saveMedia(m.id, { url: m.media, caption: m.body || '', type: m.type });
      console.error(`[router] mídia salva id=${m.id} type=${m.type}`);
    } else {
      // Documento/imagem recebido SEM URL: "Webhook Download Media" desligado no
      // UltraMsg, ou arquivo grande demais para o plano hospedar. Sem URL, o exame
      // não poderá ser analisado — logamos para diagnóstico.
      console.error(`[router] ⚠️ ${m.type} recebido SEM media URL id=${m.id} body="${(m.body || '').slice(0, 40)}" — verifique "Webhook Download Media: ON" e o limite de tamanho do plano UltraMsg`);
    }
  }

  // Persiste o TEXTO completo de mensagens de chat recebidas via webhook.
  // O GET /chats/messages pode truncar o corpo de mensagens longas (ex.: card de
  // anamnese) — o webhook entrega o texto integral em tempo real. Guardamos por id
  // para usar no /analisar. Loga o tamanho para diagnosticar truncamento do GET.
  if (m.type === 'chat') {
    const full = getMessageBody(m);
    if (full && !full.trim().startsWith('/')) {
      saveText(m.id, full, m.from, m.timestamp || m.time);
      console.error(`[router] texto salvo id=${m.id} t=${m.timestamp || m.time} len=${full.length}`);
    }
  }

  // Processa comandos (/analisar etc.) de qualquer remetente — inclusive o número
  // conectado. O bot nunca envia mensagens começando com "/", sem risco de loop.
  const body = (m.body || '').trim();
  if (m.type === 'chat' && isCommand(body)) {
    await handleCommand(chatId, body, m);
  }
}
