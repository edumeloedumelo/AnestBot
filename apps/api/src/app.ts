// Fábrica do app Express: headers seguros, CORS explícito, parsers com limite,
// rotas e tratamento central de erro (sem stack para o cliente, log sem PHI).
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { authRouter } from './auth.js';
import { inboxRouter } from './inbox.js';
import { teamsRouter } from './routes/teams.js';
import { patientsRouter } from './routes/patients.js';
import { casesRouter } from './routes/cases.js';
import { dashboardRouter } from './routes/dashboard.js';
import { recordsRouter } from './routes/records.js';
import { billingRouter } from './routes/billing.js';
import { getPool } from './db.js';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Headers de segurança (API JSON pura — sem necessidade de CSP de página).
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // CORS EXPLÍCITO: só origens da allowlist (env CORS_ORIGINS, CSV). Sem env,
  // nenhum CORS é emitido (fail-closed — chamadas same-origin/serviço seguem).
  const origins = (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && origins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    }
    next();
  });

  // Inbox usa raw body (assinatura HMAC) — registrado ANTES do json parser.
  app.use(inboxRouter());
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => { res.json({ ok: true }); });
  app.get('/ready', async (_req, res) => {
    try {
      await getPool().query('SELECT 1');
      res.json({ ready: true, checks: { database: true } });
    } catch {
      res.status(503).json({ ready: false, checks: { database: false } });
    }
  });

  app.use('/api/auth', authRouter());
  app.use('/api', teamsRouter());
  app.use('/api', patientsRouter());
  app.use('/api', casesRouter());
  app.use('/api', dashboardRouter());
  app.use('/api', recordsRouter());
  app.use('/api', billingRouter());

  app.use((_req, res) => { res.status(404).json({ error: 'rota não encontrada' }); });

  // Erro central: nunca vaza stack/SQL; log estruturado sem corpo da requisição.
  // Erros do body-parser carregam statusCode (ex.: 413 entity.too.large) — o
  // status 4xx legítimo é repassado; o resto vira 500 opaco.
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { statusCode?: number }).statusCode ?? (err as { status?: number }).status ?? 500;
    const client = status >= 400 && status < 500;
    if (!client) console.error(JSON.stringify({ level: 'error', msg: 'erro não tratado', method: req.method, path: req.path, error: err.message }));
    if (!res.headersSent) {
      res.status(client ? status : 500).json({ error: client ? (status === 413 ? 'payload excessivo' : 'requisição inválida') : 'erro interno' });
    }
  });

  return app;
}
