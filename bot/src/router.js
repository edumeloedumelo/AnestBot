// Recebe o payload do webhook UltraMsg e processa apenas comandos explícitos.
// Mensagens normais (exames, textos) ficam no grupo — o bot busca via GET quando acionado.
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

  const chatId = m.from;
  if (!isAllowed(chatId)) return;

  const body = (m.body || '').trim();

  // Só age em comandos explícitos (ex: /analisar).
  // Mensagens de exames/fotos/texto são ignoradas no webhook — serão lidas via GET ao analisar.
  if (m.type === 'chat' && isCommand(body)) {
    await handleCommand(chatId, body, m);
  }
}
