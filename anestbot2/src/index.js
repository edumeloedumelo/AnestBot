import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';
import { handleWebhook } from './webhook.js';
import { handleTelegramWebhook } from './telegram.js';

// Handlers globais: uma exceção não capturada NUNCA derruba o processo.
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e?.stack || e));
process.on('unhandledRejection', (r) => console.error('[unhandledRejection]', r));

// Verifica se /data é um volume PERSISTENTE (marcador sobrevive a redeploys).
function checkPersistence() {
  const dir = process.env.STATE_DIR || '/data';
  const marker = path.join(dir, '.persist-marker');
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(marker)) console.log(`✅ Volume persistente OK em ${dir}.`);
    else { fs.writeFileSync(marker, new Date().toISOString()); console.warn(`⚠️  ${dir}: marcador criado agora. Se reaparecer a CADA deploy, o volume NÃO está montado.`); }
  } catch (e) { console.error(`❌ ${dir} não gravável (${e.message}) — estado NÃO persiste.`); }
}

const app = express();
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

app.get('/', (_req, res) => res.send('ANESTBOT online ✅'));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.post('/webhook', (req, res) => {
  res.sendStatus(200); // responde já; processa em background
  handleWebhook(req.body).catch((e) => console.error('[webhook] erro:', e));
});
// Canal Telegram (Bot API oficial). Se TELEGRAM_WEBHOOK_SECRET estiver
// definido, exige o header que o próprio Telegram envia quando o webhook é
// registrado com secret_token — bloqueia POSTs forjados por terceiros.
app.post('/telegram-webhook', (req, res) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.get('X-Telegram-Bot-Api-Secret-Token') !== secret) return res.sendStatus(403);
  res.sendStatus(200);
  handleTelegramWebhook(req.body).catch((e) => console.error('[telegram] erro:', e));
});
app.use((err, _req, res, _next) => { console.error('[http] parse error:', err.message); if (!res.headersSent) res.sendStatus(200); });

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🤖 ANESTBOT ouvindo na porta ${port}`);
  checkPersistence();
  if (!process.env.ULTRAMSG_INSTANCE_ID || !process.env.ULTRAMSG_TOKEN) console.warn('⚠️  ULTRAMSG_INSTANCE_ID/TOKEN não configurados (canal WhatsApp inativo).');
  if (!process.env.ANTHROPIC_API_KEY) console.warn('⚠️  ANTHROPIC_API_KEY não configurada.');
  console.log(process.env.TELEGRAM_BOT_TOKEN ? '✈️  Canal Telegram ATIVO (webhook: /telegram-webhook)' : 'ℹ️  Canal Telegram inativo (defina TELEGRAM_BOT_TOKEN para ativar).');
});
