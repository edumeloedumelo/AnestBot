// Runner de migrations simples: aplica todo .sql em src/migrations ainda não aplicado, em ordem.
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function run() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await pool.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename)
  );

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    console.log(`[migrate] aplicando ${file}...`);
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await pool.query('COMMIT');
      console.log(`[migrate] ${file} aplicada com sucesso.`);
    } catch (e) {
      await pool.query('ROLLBACK');
      console.error(`[migrate] falhou em ${file}:`, e.message);
      process.exit(1);
    }
  }

  console.log('[migrate] tudo em dia.');
  await pool.end();
}

run();
