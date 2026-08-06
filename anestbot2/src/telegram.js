// Adaptador Telegram (Bot API oficial) — canal paralelo ao WhatsApp/UltraMsg.
//
// Diferenças-chave para o WhatsApp:
//   • API oficial e gratuita: nunca desconecta, sem risco de bloqueio de número.
//   • O bot NÃO recebe as próprias mensagens (eco não existe → fromMe=false).
//   • Mídia chega como file_id; o link real é resolvido via getFile NA HORA do
//     download (os links expiram em ~1h — nunca armazenar o link, só o file_id).
//   • getFile só baixa arquivos até 20 MB — acima disso, erro claro + reenvio.
//
// chatIds do Telegram são prefixados com "tg:" no store/roteamento, para nunca
// colidir com os ids do WhatsApp (@g.us/@c.us).
import { splitMessage } from './ultramsg.js';
import { processIncoming } from './webhook.js';

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API = () => `https://api.telegram.org/bot${TG_TOKEN}`;
const SEND_TIMEOUT_MS = 20_000;
const GETFILE_TIMEOUT_MS = 15_000;
export const TG_DOWNLOAD_LIMIT = 20 * 1024 * 1024; // limite do getFile (Bot API em nuvem)

export const isTelegramChat = (chatId) => String(chatId).startsWith('tg:');

// ── envio ────────────────────────────────────────────────────────────────────
// Uma tentativa = um timeout próprio; o corpo da resposta é SEMPRE consumido
// (res.json), inclusive no sucesso — senão cada envio deixa uma conexão
// pendente (achado de auditoria).
async function tgSendOnce(chatId, text, useMarkdown) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const payload = { chat_id: chatId, text };
    if (useMarkdown) payload.parse_mode = 'Markdown';
    const res = await fetch(`${API()}/sendMessage`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendTelegramText(chatId, body) {
  if (!body) { console.error(`[telegram] corpo VAZIO — nada enviado para ${chatId}`); return; }
  if (!TG_TOKEN) { console.error('[telegram] TELEGRAM_BOT_TOKEN não configurado — envio ignorado'); return; }
  for (const chunk of splitMessage(body)) {
    try {
      // 1ª tentativa com Markdown (deixa os *negritos* do laudo bonitos);
      // asterisco desbalanceado → 400 → reenvia como texto puro com timeout
      // NOVO (conteúdo NUNCA pode ser perdido por formatação nem por orçamento
      // de tempo herdado da 1ª tentativa).
      let r = await tgSendOnce(chatId, chunk, true);
      if (!r.ok) {
        r = await tgSendOnce(chatId, chunk, false);
        if (!r.ok) console.error('[telegram] send error', r.status, JSON.stringify(r.data).slice(0, 200));
      }
    } catch (e) {
      console.error('[telegram] falha no envio:', e.name === 'AbortError' ? `timeout (${SEND_TIMEOUT_MS / 1000}s)` : e.message);
    }
  }
}

// ── mídia: file_id → URL fresca de download ─────────────────────────────────
export async function telegramFileUrl(fileId) {
  if (!TG_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN não configurado');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GETFILE_TIMEOUT_MS);
  try {
    const res = await fetch(`${API()}/getFile?file_id=${encodeURIComponent(fileId)}`, { signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!data.ok || !data.result?.file_path) {
      const desc = data.description || `HTTP ${res.status}`;
      if (/too big/i.test(desc)) {
        throw new Error('arquivo acima de 20 MB — o Telegram não permite o download pelo bot. Reenvie comprimido ou dividido.');
      }
      throw new Error(`Telegram getFile falhou: ${desc}`);
    }
    return `https://api.telegram.org/file/bot${TG_TOKEN}/${data.result.file_path}`;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Telegram getFile travou (${GETFILE_TIMEOUT_MS / 1000}s)`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ── normalização do update (pura — exportada para os testes) ────────────────
// Devolve { norm, oversizeName } ou null (update sem mensagem útil).
export function normalizeTelegramUpdate(update) {
  const m = update?.message;
  if (!m || !m.chat || !m.message_id) return null;

  const chatId = 'tg:' + m.chat.id;
  let type = 'chat';
  let mediaUrl = '';
  let oversizeName = null;
  let body = (m.text || m.caption || '').trim();

  if (Array.isArray(m.photo) && m.photo.length) {
    type = 'image';
    mediaUrl = 'tg:' + m.photo[m.photo.length - 1].file_id; // maior resolução
  } else if (m.document) {
    type = 'document';
    mediaUrl = 'tg:' + m.document.file_id;
    if ((m.document.file_size || 0) > TG_DOWNLOAD_LIMIT) oversizeName = m.document.file_name || 'documento';
    if (!body && m.document.file_name) body = m.document.file_name;
  } else if (m.video) {
    type = 'video';
    mediaUrl = 'tg:' + m.video.file_id;
    if ((m.video.file_size || 0) > TG_DOWNLOAD_LIMIT) oversizeName = m.video.file_name || 'vídeo';
  } else if (!m.text) {
    return { norm: null, unsupported: m.voice ? 'voice' : m.sticker ? 'sticker' : m.audio ? 'audio' : 'outro', chatId };
  }

  // Em grupos o Telegram manda "/analisar@NomeDoBot" — normaliza para "/analisar".
  if (body.startsWith('/')) body = body.replace(/^(\/[A-Za-z0-9_]+)@\S+/, '$1');

  return {
    norm: {
      id: `tg${m.chat.id}_${m.message_id}`,
      chatId,
      type,
      body,
      mediaUrl,
      timestamp: Number(m.date) || Math.floor(Date.now() / 1000),
      fromMe: false,                      // o Telegram nunca entrega eco do bot
      author: String(m.from?.id || ''),   // id numérico do usuário (p/ admin)
    },
    oversizeName,
  };
}

// ── webhook ──────────────────────────────────────────────────────────────────
export async function handleTelegramWebhook(update) {
  const parsed = normalizeTelegramUpdate(update);
  if (!parsed) return;
  if (!parsed.norm) {
    console.error(`[telegram] tipo não suportado (${parsed.unsupported}) — ignorado chat=${parsed.chatId} (se for exame, reenviar como foto/PDF)`);
    return;
  }
  const { norm, oversizeName } = parsed;
  console.error(`[telegram] update chat=${norm.chatId} type=${norm.type} len=${norm.body.length} de=${norm.author}`);

  // Arquivo já sabidamente acima do limite: avisa NA HORA (o download falharia
  // só no /analisar, tarde demais para a secretária reagir).
  if (oversizeName) {
    await sendTelegramText(String(update.message.chat.id), `📎 "${oversizeName}" passa de 20 MB — o Telegram não permite que o bot baixe arquivos desse tamanho. Reenvie comprimido (ou dividido em partes menores).`);
  }

  await processIncoming(norm);
}
