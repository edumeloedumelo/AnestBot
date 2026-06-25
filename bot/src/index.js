import 'dotenv/config';
import express from 'express';
import { handleWebhook } from './router.js';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.get('/', (_req, res) => res.send('AnestGuide WhatsApp bot online ✅'));
app.get('/health', (_req, res) => res.json({ ok: true }));

// Webhook do UltraMsg. Respondemos 200 imediatamente e processamos em background,
// pois a análise no Claude leva alguns segundos (evita timeout/retry do UltraMsg).
app.post('/webhook', (req, res) => {
  res.sendStatus(200);
  handleWebhook(req.body).catch((e) => console.error('[webhook] erro:', e));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🤖 AnestGuide WhatsApp bot ouvindo na porta ${port}`);
  if (!process.env.ULTRAMSG_INSTANCE_ID || !process.env.ULTRAMSG_TOKEN) {
    console.warn('⚠️  ULTRAMSG_INSTANCE_ID/ULTRAMSG_TOKEN não configurados.');
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY não configurada.');
  }
});
