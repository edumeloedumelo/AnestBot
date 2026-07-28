// Normaliza o payload do webhook UltraMsg e grava a mensagem no store.
// Também dispara comandos (/analisar etc.) quando a mensagem é um comando.
import { appendMessage } from './store.js';
import { isCommand, handleCommand } from './commands.js';

const ALLOWED = (process.env.ALLOWED_CHATS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

function isAllowed(chatId) {
  return ALLOWED.length === 0 || ALLOWED.includes(chatId);
}

// Extrai o texto de forma robusta. Mensagens encaminhadas / de tipos diversos /
// de APIs estilo Baileys trazem o texto em campos variados (às vezes aninhados).
export function getBody(m) {
  const cands = [
    m.body, m.text, m.caption, m.content, m.quotedMsgBody, m.conversation,
    m.extendedTextMessage?.text, m.msg,
    typeof m.message === 'string' ? m.message : undefined,
    m.message?.conversation,
    m.message?.extendedTextMessage?.text,
    m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation,
    m.contextInfo?.quotedMessage?.conversation,
    typeof m.data === 'string' ? m.data : undefined,
    m.data?.body, m.data?.message,
  ];
  // Retorna o candidato MAIS LONGO (o webhook às vezes traz um preview curto em
  // m.body e o texto completo em outro campo).
  let best = '';
  for (const c of cands) {
    if (typeof c === 'string' && c.trim().length > best.length) best = c.trim();
  }
  return best;
}

export async function handleWebhook(payload) {
  if (!payload) return;

  const et = payload.event_type;
  const isMsg = !et || et === 'message_received' || et === 'message_create' || et === 'message_created';
  if (!isMsg) return;

  const m = payload.data;
  if (!m || !m.id) return;

  const chatId = m.from;
  if (!isAllowed(chatId)) return;

  const type = m.type || 'chat';
  const body = getBody(m);
  const timestamp = Number(m.timestamp || m.time || Math.floor(Date.now() / 1000));

  // Comando (/analisar etc.): dispara, mas NÃO grava no store (mantém o histórico limpo).
  if (type === 'chat' && isCommand(body)) {
    await handleCommand(chatId, body, m);
    return;
  }

  // Grava conteúdo relevante: texto (chat) ou mídia (image/document/video).
  const isMedia = type === 'image' || type === 'document' || type === 'video';
  const hasContent = (type === 'chat' && body) || (isMedia);

  if (hasContent) {
    appendMessage(chatId, {
      id: m.id,
      chatId,
      type,
      body,                         // texto completo (do webhook, nunca truncado)
      mediaUrl: isMedia ? (m.media || '') : '',
      caption: isMedia ? body : '',
      timestamp,
      fromMe: !!m.fromMe,
    });
    if (isMedia) {
      console.error(`[webhook] mídia gravada chat=${chatId} type=${type} url=${m.media ? 'sim' : 'AUSENTE'}`);
    } else {
      console.error(`[webhook] texto gravado chat=${chatId} len=${body.length}`);
    }
  }
}
