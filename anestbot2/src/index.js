import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';
import { handleWebhook } from './webhook.js';
import { webhookAuthDecision, readinessCheck, diagAuthorized } from './security.js';
import { diagSnapshot } from './store.js';
import { getConfig } from './config.js';
import { startOutboxPump, outboxSnapshot } from './events.js';

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
// Limite de payload (D-005): o webhook UltraMsg com "Download Media: ON" envia
// URL de mídia (não base64) — payload normal tem poucos KB. 5mb dá folga ampla
// e fecha o vetor de abuso de memória que 60mb abria. Ajustável por env.
const BODY_LIMIT = process.env.WEBHOOK_BODY_LIMIT || '5mb';
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

app.get('/', (_req, res) => res.send('ANESTBOT online ✅'));
// /health é LIVENESS pura (processo vivo) — dependências ficam no /ready.
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/ready', (_req, res) => {
  const { ready, checks } = readinessCheck();
  res.status(ready ? 200 : 503).json({ ready, checks });
});
// Diagnóstico protegido (D-006): fail-closed — sem DIAG_TOKEN configurado, 404.
// Devolve SOMENTE metadados agregados; nunca conteúdo clínico, nomes ou chats.
app.get('/diag', (req, res) => {
  if (!diagAuthorized(req.query)) return res.sendStatus(404);
  const cfg = getConfig();
  res.json({
    uptime_s: Math.round(process.uptime()),
    node: process.version,
    store: diagSnapshot(),
    outbox: outboxSnapshot(),
    config: { surgeries: cfg.surgeries.length, exam_limits: cfg.examLimits.length, extra_prompt_set: !!cfg.extraPrompt },
    env: readinessCheck().checks,
  });
});
app.post('/webhook', (req, res) => {
  // Autenticação do webhook (D-003): com WEBHOOK_TOKEN configurado, requisição
  // sem token válido é 401 e NÃO é processada. Sem a env: modo compatibilidade.
  const denied = webhookAuthDecision(req.query);
  if (denied) { console.error(`[webhook] NÃO AUTORIZADO (${denied}) — descartado`); return res.sendStatus(401); }
  res.sendStatus(200); // responde já; processa em background
  handleWebhook(req.body).catch((e) => console.error('[webhook] erro:', e));
});
app.use((err, _req, res, _next) => { console.error('[http] parse error:', err.message); if (!res.headersSent) res.sendStatus(200); });

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🤖 ANESTBOT ouvindo na porta ${port}`);
  checkPersistence();
  if (!process.env.ULTRAMSG_INSTANCE_ID || !process.env.ULTRAMSG_TOKEN) console.warn('⚠️  ULTRAMSG_INSTANCE_ID/TOKEN não configurados.');
  if (!process.env.ANTHROPIC_API_KEY) console.warn('⚠️  ANTHROPIC_API_KEY não configurada.');
  if (!process.env.WEBHOOK_TOKEN) console.warn('🚨 WEBHOOK_TOKEN não configurado — o /webhook está SEM autenticação (modo compatibilidade). Configure a env e aponte o UltraMsg para /webhook?token=SEU_TOKEN.');
  if (!(process.env.ADMIN_NUMBERS || '').trim()) console.warn('⚠️  ADMIN_NUMBERS vazio — comandos de admin restritos ao número conectado (fromMe). Configure para liberar outros números.');
  // Marco 1: retoma a entrega de eventos pendentes no outbox (no-op sem env).
  startOutboxPump();
});
