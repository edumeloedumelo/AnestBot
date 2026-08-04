// Runner de migrations mínimo e auditável: aplica os .sql de
// packages/database/migrations em ordem, registrando checksum — uma migration
// aplicada NUNCA pode mudar (falha alto se o arquivo divergir do registrado).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from './db.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Funciona de src/ (tsx) e de dist/ (build) — o repo é a âncora.
export const MIGRATIONS_DIR = path.resolve(HERE, '..', '..', '..', 'packages', 'database', 'migrations');

const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');

export async function runMigrations(dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const pool = getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const name of files) {
    const sql = fs.readFileSync(path.join(dir, name), 'utf-8');
    const checksum = sha256(sql);
    const prev = await pool.query('SELECT checksum FROM schema_migrations WHERE name = $1', [name]);
    if (prev.rowCount) {
      const stored = (prev.rows[0] as { checksum: string }).checksum;
      if (stored !== checksum) throw new Error(`migration ${name} foi ALTERADA após aplicada (checksum divergente) — crie uma migration nova`);
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
      await client.query('COMMIT');
      applied.push(name);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => { /* já perdida */ });
      throw new Error(`migration ${name} falhou: ${(e as Error).message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}

// Execução direta: npm run migrate
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations()
    .then((a) => { console.log(JSON.stringify({ msg: 'migrations ok', applied: a })); return closePool(); })
    .catch((e) => { console.error(JSON.stringify({ level: 'error', msg: 'migrate falhou', error: (e as Error).message })); process.exit(1); });
}
