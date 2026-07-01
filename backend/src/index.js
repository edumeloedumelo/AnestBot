import 'dotenv/config';
import express from 'express';
import { authRouter } from './routes/auth.js';
import { billingRouter, stripeWebhookHandler } from './routes/billing.js';
import { provisioningRouter, adminProvisioningRouter } from './routes/provisioning.js';
import { adminRouter } from './routes/admin.js';
import { requireAuth, requireOwner } from './middleware/auth.js';
import { startWorkers } from './workers/index.js';

const app = express();

// Stripe exige o corpo cru (não parseado) pra validar a assinatura do webhook —
// por isso esse único endpoint é montado ANTES do express.json() global.
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookHandler);

app.use(express.json({ limit: '20mb' }));

app.get('/', (_req, res) => res.send('AnestGuide backend online ✅'));
app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/auth', authRouter);
app.use('/billing', requireAuth, billingRouter);
app.use('/onboarding', requireAuth, provisioningRouter);
app.use('/admin', requireAuth, requireOwner, adminRouter);
app.use('/admin', requireAuth, requireOwner, adminProvisioningRouter);

app.use((err, _req, res, _next) => {
  console.error('[http] erro:', err.message);
  if (!res.headersSent) res.status(500).json({ error: 'erro interno' });
});

// Rede de segurança de última instância: nenhum handler deveria depender disso
// (todo async handler já passa por asyncHandler), mas um processo inteiro cair
// por causa de UM tenant/requisição é sempre pior que logar e seguir vivo.
process.on('unhandledRejection', (err) => {
  console.error('[fatal-safety-net] unhandledRejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('[fatal-safety-net] uncaughtException:', err);
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`🏢 AnestGuide backend ouvindo na porta ${port}`);
  for (const key of ['DATABASE_URL', 'JWT_SECRET', 'TOKEN_ENCRYPTION_KEY', 'STRIPE_SECRET_KEY']) {
    if (!process.env[key]) console.warn(`⚠️  ${key} não configurada.`);
  }
  startWorkers();
});
