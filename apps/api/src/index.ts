// Entrada do servidor da plataforma.
import 'dotenv/config';
import { createApp } from './app.js';
import { runMigrations } from './migrate.js';

process.on('uncaughtException', (e) => console.error(JSON.stringify({ level: 'fatal', msg: 'uncaughtException', error: (e as Error)?.message ?? String(e) })));
process.on('unhandledRejection', (r) => console.error(JSON.stringify({ level: 'fatal', msg: 'unhandledRejection', error: String(r) })));

const port = parseInt(process.env.PORT ?? '4000', 10);

async function main(): Promise<void> {
  if (process.env.MIGRATE_ON_BOOT === '1') {
    const applied = await runMigrations();
    if (applied.length) console.error(JSON.stringify({ level: 'info', msg: 'migrations aplicadas', applied }));
  }
  const app = createApp();
  app.listen(port, () => {
    console.error(JSON.stringify({ level: 'info', msg: 'api ouvindo', port }));
    if (!process.env.PLATFORM_EVENTS_SECRET) console.error(JSON.stringify({ level: 'warn', msg: 'PLATFORM_EVENTS_SECRET ausente — inbox de eventos responderá 503' }));
    if (!process.env.CORS_ORIGINS) console.error(JSON.stringify({ level: 'info', msg: 'CORS_ORIGINS ausente — nenhuma origem cross-site permitida (fail-closed)' }));
  });
}

main().catch((e) => {
  console.error(JSON.stringify({ level: 'fatal', msg: 'boot falhou', error: (e as Error).message }));
  process.exit(1);
});
