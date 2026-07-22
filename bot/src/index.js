import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';
import { handleWebhook } from './router.js';

// Verifica se STATE_DIR (/data) é um volume PERSISTENTE. Se um marcador escrito num
// boot anterior sobreviveu, o volume está montado corretamente. Se some a cada deploy,
// os dados (config, mídia, estado) estão sendo perdidos — causa raiz de "perder coisas
// antigas a cada deploy". O aviso abaixo torna isso visível nos logs do Railway.
function checkPersistence() {
  const dir = process.env.STATE_DIR || '/data';
  const marker = path.join(dir, '.persist-marker');
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(marker)) {
      const since = fs.readFileSync(marker, 'utf-8').trim();
      console.log(`✅ Volume persistente OK em ${dir} (marcador desde ${since}).`);
    } else {
      fs.writeFileSync(marker, new Date().toISOString());
      console.warn(`⚠️  ${dir}: marcador de persistência criado agora. Se ESTE aviso reaparecer a cada deploy, o volume NÃO está montado e os dados serão perdidos. Monte um volume Railway em ${dir}.`);
    }
  } catch (e) {
    console.error(`❌ ${dir} não é gravável (${e.message}). Estado e mídia NÃO persistirão.`);
  }
}

// Handlers globais: garantem que uma exceção não capturada ou uma promise rejeitada
// NUNCA derrubem o processo. Antes, um writeFileSync falho em /data podia matar o bot.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] processo mantido vivo:', err?.stack || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] processo mantido vivo:', reason);
});

const app = express();
// Limite alto: com "Webhook Download Media: ON" o UltraMsg embute mídia (base64)
// no payload, que pode passar de 10MB para PDFs/imagens grandes.
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

app.get('/', (_req, res) => res.send('AnestGuide WhatsApp bot online ✅'));
app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/webhook', (req, res) => {
  res.sendStatus(200);
  handleWebhook(req.body).catch((e) => console.error('[webhook] erro:', e));
});

// Tratador de erros (payload grande/JSON inválido) — responde 200 e não derruba o processo.
app.use((err, _req, res, _next) => {
  console.error('[http] erro no parse do body:', err.message);
  if (!res.headersSent) res.sendStatus(200);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🤖 AnestGuide WhatsApp bot ouvindo na porta ${port}`);
  checkPersistence();
  if (!process.env.ULTRAMSG_INSTANCE_ID || !process.env.ULTRAMSG_TOKEN) {
    console.warn('⚠️  ULTRAMSG_INSTANCE_ID/ULTRAMSG_TOKEN não configurados.');
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY não configurada.');
  }
});
