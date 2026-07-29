// Normaliza o payload do webhook UltraMsg e grava a mensagem no store.
// Também dispara comandos (/analisar etc.) quando a mensagem é um comando.
import { appendMessage, isCaseOpen, setCaseOpen, isBotText, pushPendingMedia, adoptPendingMedia, recordCaseClosed, lastClosedTime } from './store.js';
import { isCaseOpener, isSeparator } from './parser.js';
import { isCommand, handleCommand } from './commands.js';
import { sendText } from './ultramsg.js';

const LATE_MEDIA_WINDOW_S = 120;

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
// Robustez extra: se um dos lados é um GRUPO (@g.us), o chat é sempre o grupo.
export function resolveChatId(m) {
  const isGroup = (s) => typeof s === 'string' && s.endsWith('@g.us');
  if (isGroup(m.from)) return m.from;
  if (isGroup(m.to)) return m.to;
  if (m.fromMe && m.to) return m.to;
  return m.from;
}

// Decide se a mensagem é capturada e qual passa a ser o estado do bloco.
//   • "xxxx" na 1ª linha ABRE o caso (mesmo colado ao card)
//   • "❌❌❌❌" na última linha FECHA o caso (mesmo colado ao conteúdo)
//   • texto/mídia só são gravados com caso aberto (ou na própria msg de marcador)
export function gateDecision(open, type, body) {
  if (type !== 'chat') return { store: open, nowOpen: open, opens: false, closes: false }; // mídia: só dentro do bloco
  const lines = (body || '').trim().split('\n');
  const opens = lines.length > 0 && isCaseOpener(lines[0]);
  const closes = lines.length > 0 && isSeparator(lines[lines.length - 1]);
  return {
    store: opens || closes || open,
    nowOpen: closes ? false : (opens ? true : open),
    opens,
    closes,
  };
}

// Mídia FORA de bloco (o webhook de mídia da UltraMsg chega MINUTOS depois do
// texto — este é o fluxo NORMAL, não exceção). Decisão pelo timestamp de ENVIO
// do WhatsApp, não pela ordem de chegada:
//   'inside'  — enviada ANTES do ❌❌❌❌ (caso recente): entra DENTRO do caso,
//               com o timestamp original (ordena no lugar certo). SILENCIOSA.
//   'late'    — enviada logo APÓS o fechamento (≤120s): anexada ao caso fechado.
//   'pending' — resto: aguarda um caso abrir.
export function handleOrphanMedia(chatId, msg) {
  const closed = lastClosedTime(chatId);
  const ts = msg.timestamp || 0;
  if (closed) {
    if (ts <= closed + 1 && closed - ts <= 3600) {
      appendMessage(chatId, msg); // timestamp original → dentro do caso
      return 'inside';
    }
    if (ts > closed && ts - closed <= LATE_MEDIA_WINDOW_S) {
      appendMessage(chatId, { ...msg, timestamp: closed });
      return 'late';
    }
  }
  pushPendingMedia(chatId, msg);
  return 'pending';
}

// Aviso de exame atrasado: no máximo 1 por grupo a cada 120s (nunca spam).
const lastLateNotice = new Map();
export function shouldNotifyLate(chatId, now = Date.now()) {
  const last = lastLateNotice.get(chatId) || 0;
  if (now - last < LATE_MEDIA_WINDOW_S * 1000) return false;
  lastLateNotice.set(chatId, now);
  return true;
}

export async function handleWebhook(payload) {
  if (!payload) return;

  const et = payload.event_type;
  const isMsg = !et || et === 'message_received' || et === 'message_create' || et === 'message_created';
  if (!isMsg) return;

  const m = payload.data;
  if (!m || !m.id) return;

  const chatId = resolveChatId(m);

  const type = m.type || 'chat';
  const body = getBody(m);

  // Log de TODO evento — essencial para depurar webhook/comandos nos logs do Railway.
  console.error(`[webhook] evento=${et || 'msg'} from=${m.from} to=${m.to || '-'} fromMe=${!!m.fromMe} type=${type} len=${body.length} chat=${chatId}`);

  if (!isAllowed(chatId)) { console.error(`[webhook] chat não permitido: ${chatId}`); return; }

  const timestamp = Number(m.timestamp || m.time || Math.floor(Date.now() / 1000));

  // Comando (/analisar etc.): dispara, mas NÃO grava no store (mantém o histórico limpo).
  // Funciona em grupo e no privado, inclusive vindo do próprio número conectado.
  if (type === 'chat' && isCommand(body)) {
    console.error(`[webhook] comando "${body.trim().split(/\s/)[0]}" chat=${chatId} fromMe=${!!m.fromMe}`);
    await handleCommand(chatId, body, m);
    return;
  }

  // ── PORTÃO DE CAPTURA (regra absoluta) ────────────────────────────────────
  // O webhook SÓ captura conteúdo entre xxxx e ❌❌❌❌. Conversa fora de um
  // caso aberto NÃO é gravada — nem texto, nem mídia. Comandos (acima) sempre
  // funcionam, em grupo ou no privado.
  // Eco do próprio bot (resposta enviada via API voltando pelo webhook): nunca
  // é conteúdo clínico, mesmo com caso aberto.
  if (m.fromMe && type === 'chat' && isBotText(chatId, body)) {
    console.error(`[webhook] eco do bot descartado chat=${chatId}`);
    return;
  }

  const isMedia = type === 'image' || type === 'document' || type === 'video';
  const wasOpen = isCaseOpen(chatId);
  const { store, nowOpen, opens, closes } = gateDecision(wasOpen, type, body);
  if (type === 'chat') {
    setCaseOpen(chatId, nowOpen);
    // Só quando FECHA um caso real (aberto antes ou aberto nesta mensagem) —
    // um ❌❌❌❌ redundante não vira marco de fechamento (prescrição do coordenador).
    if (closes && (wasOpen || opens)) recordCaseClosed(chatId, timestamp);
  }

  const hasContent = store && ((type === 'chat' && body) || isMedia);

  if (!hasContent && isMedia) {
    const fate = handleOrphanMedia(chatId, {
      id: m.id, chatId, type, body, mediaUrl: m.media || '', caption: body,
      timestamp, fromMe: !!m.fromMe,
    });
    if (fate === 'inside') {
      console.error(`[webhook] mídia com envio anterior ao ❌❌❌❌ — incluída no caso chat=${chatId}`);
    } else if (fate === 'late') {
      console.error(`[webhook] mídia após ❌❌❌❌ — anexada ao caso FECHADO chat=${chatId}`);
      if (shouldNotifyLate(chatId)) {
        await sendText(chatId, `📎 Exame(s) recebido(s) após o ❌❌❌❌ — anexado(s) ao caso ANTERIOR. Rode /analisar para reprocessar com os exames incluídos.`);
      }
    } else {
      console.error(`[webhook] mídia fora de bloco — pendente chat=${chatId} type=${type}`);
    }
    return;
  }
  if (!hasContent && type === 'chat' && body) {
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
    // Caso ABRIU nesta mensagem (mesmo que também feche nela): adota mídias
    // pendentes recentes (chegaram antes do xxxx).
    if (type === 'chat' && opens) {
      const adopted = adoptPendingMedia(chatId, timestamp);
      if (adopted) console.error(`[webhook] ${adopted} mídia(s) pendente(s) adotada(s) chat=${chatId}`);
    }
  }
}
