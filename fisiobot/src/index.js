import 'dotenv/config';
import express from 'express';
import { handleWebhook } from './router.js';

const app = express();
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

app.get('/', (_req, res) => res.send('FisioBot — Avaliação Fisioterapêutica online 🦴'));
app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/webhook', (req, res) => {
  res.sendStatus(200);
  handleWebhook(req.body).catch((e) => console.error('[webhook] erro:', e));
});

app.use((err, _req, res, _next) => {
  console.error('[http] erro no parse do body:', err.message);
  if (!res.headersSent) res.sendStatus(200);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🦴 FisioBot ouvindo na porta ${port}`);
  if (!process.env.ULTRAMSG_INSTANCE_ID || !process.env.ULTRAMSG_TOKEN)
    console.warn('⚠️  ULTRAMSG_INSTANCE_ID/ULTRAMSG_TOKEN não configurados.');
  if (!process.env.ANTHROPIC_API_KEY)
    console.warn('⚠️  ANTHROPIC_API_KEY não configurada.');
});
