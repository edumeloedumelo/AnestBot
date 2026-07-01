import 'dotenv/config';
import express from 'express';
import { handleWebhook } from './router.js';

const app = express();
// Limite alto: com "Webhook Download Media: ON" o UltraMsg embute mídia (base64)
// no payload, que pode passar de 10MB para PDFs/imagens grandes.
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

app.get('/', (_req, res) => res.send('AnestGuide WhatsApp bot online ✅'));
app.get('/health', (_req, res) => res.json({ ok: true }));

// Cada instância UltraMsg (uma por tenant) tem sua própria URL de webhook
// configurada no painel dela, apontando pra /webhook/:tenantId.
app.post('/webhook/:tenantId', (req, res) => {
  res.sendStatus(200);
  handleWebhook(req.params.tenantId, req.body).catch((e) => console.error('[webhook] erro:', e));
});

// Tratador de erros (payload grande/JSON inválido) — responde 200 e não derruba o processo.
app.use((err, _req, res, _next) => {
  console.error('[http] erro no parse do body:', err.message);
  if (!res.headersSent) res.sendStatus(200);
});

// Rede de segurança de última instância — nenhuma requisição de UM tenant pode
// derrubar o processo inteiro e tirar TODOS os outros do ar.
process.on('unhandledRejection', (err) => {
  console.error('[fatal-safety-net] unhandledRejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('[fatal-safety-net] uncaughtException:', err);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🤖 AnestGuide WhatsApp bot ouvindo na porta ${port}`);
  if (!process.env.DATABASE_URL) console.warn('⚠️  DATABASE_URL não configurada.');
  if (!process.env.TOKEN_ENCRYPTION_KEY) console.warn('⚠️  TOKEN_ENCRYPTION_KEY não configurada.');
  if (!process.env.ANTHROPIC_API_KEY) console.warn('⚠️  ANTHROPIC_API_KEY não configurada.');
});
