// Normaliza o payload do webhook UltraMsg e grava a mensagem no store.
// Também dispara comandos (/analisar etc.) quando a mensagem é um comando.
import { appendMessage, isCaseOpen, setCaseOpen } from './store.js';
import { isCaseOpener, isSeparator } from './parser.js';
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

// Resolve o id do GRUPO/CONVERSA. Em mensagens do PRÓPRIO número (fromMe /
// message_create) a UltraMsg manda from=próprio número e to=grupo — o chat é o "to".
export function resolveChatId(m) {
  if (m.fromMe && m.to) return m.to;
  return m.from;
}

// Decide se a mensagem é capturada e qual passa a ser o estado do bloco.
//   • "xxxx" na 1ª linha ABRE o caso (mesmo colado ao card)
//   • "❌❌❌❌" na última linha FECHA o caso (mesmo colado ao conteúdo)
//   • texto/mídia só são gravados com caso aberto (ou na própria msg de marcador)
export function gateDecision(open, type, body) {
  if (type !== 'chat') return { store: open, nowOpen: open }; // mídia: só dentro do bloco
  const lines = (body || '').trim().split('\n');
  const opens = lines.length > 0 && isCaseOpener(lines[0]);
  const closes = lines.length > 0 && isSeparator(lines[lines.length - 1]);
  return {
    store: opens || closes || open,
    nowOpen: closes ? false : (opens ? true : open),
  };
}

export async function handleWebhook(payload) {
  if (!payload) return;

  const et = payload.event_type;
  const isMsg = !et || et === 'message_received' || et === 'message_create' || et === 'message_created';
  if (!isMsg) return;

  const m = payload.data;
  if (!m || !m.id) return;

  const chatId = resolveChatId(m);
  if (!isAllowed(chatId)) return;

  const type = m.type || 'chat';
  const body = getBody(m);
  const timestamp = Number(m.timestamp || m.time || Math.floor(Date.now() / 1000));

  // Comando (/analisar etc.): dispara, mas NÃO grava no store (mantém o histórico limpo).
  if (type === 'chat' && isCommand(body)) {
    await handleCommand(chatId, body, m);
    return;
  }

  // ── PORTÃO DE CAPTURA (regra absoluta) ────────────────────────────────────
  // O webhook SÓ captura conteúdo entre xxxx e ❌❌❌❌. Conversa fora de um
  // caso aberto NÃO é gravada — nem texto, nem mídia. Comandos (acima) sempre
  // funcionam, em grupo ou no privado.
  const isMedia = type === 'image' || type === 'document' || type === 'video';
  const { store, nowOpen } = gateDecision(isCaseOpen(chatId), type, body);
  if (type === 'chat') setCaseOpen(chatId, nowOpen);

  const hasContent = store && ((type === 'chat' && body) || isMedia);

  if (!hasContent && ((type === 'chat' && body) || isMedia)) {
    console.error(`[webhook] fora de bloco xxxx/❌❌❌❌ — ignorado chat=${chatId} type=${type}`);
  }

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
