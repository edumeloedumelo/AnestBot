import 'dotenv/config';
import express from 'express';
import { handleWebhook } from './router.js';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
  res.sendStatus(200);
  handleWebhook(body).catch((e) => console.error('[webhook] erro:', e));
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
