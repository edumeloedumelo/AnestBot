import 'dotenv/config';
import express from 'express';
import { handleWebhook } from './router.js';

const app = express();
// Limite alto: com "Webhook Download Media: ON" o UltraMsg embute mídia (base64)
// no payload, que pode passar de 10MB para PDFs/imagens grandes.
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

// Log de todas as requisições recebidas
app.use((req, _res, next) => {
  console.log(`[http] ${req.method} ${req.path}`);
  next();
});

app.get('/', (_req, res) => res.send('AnestGuide WhatsApp bot online ✅'));
app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/webhook', (req, res) => {
  const body = req.body;
  const type = body?.data?.type || '?';
  const from = body?.data?.from || '?';
  const msgBody = (body?.data?.body || '').substring(0, 60);
  console.log(`[webhook] event=${body?.event_type} type=${type} from=${from} body="${msgBody}"`);
  if (type === 'image' || type === 'document') {
    const d = body?.data || {};
    console.log('[webhook] media url presente?', !!d.media, 'tamanho payload:', JSON.stringify(body).length);
  }
  res.sendStatus(200);
  handleWebhook(body).catch((e) => console.error('[webhook] erro:', e));
});

// Tratador de erros (payload grande/JSON inválido) — responde 200 e não derruba o processo.
app.use((err, _req, res, _next) => {
  console.error('[http] erro no parse do body:', err.message);
  if (!res.headersSent) res.sendStatus(200);
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
