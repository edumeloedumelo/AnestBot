/**
 * Runner de migrations: aplica os arquivos .sql de ./migrations em ordem
 * lexicográfica, uma transação por migration, registrando nome + checksum em
 * schema_migrations. Reexecutar é idempotente; um arquivo já aplicado com
 * checksum diferente aborta (migrations aplicadas são imutáveis).
 *
 * Conexão via variáveis de ambiente padrão do pg (PGHOST, PGPORT, PGUSER,
 * PGDATABASE, PGPASSWORD) ou DATABASE_URL.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = join(__dirname, "..", "migrations");

export async function migrate(client: Client): Promise<string[]> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Map<string, string>(
    (await client.query("SELECT name, checksum FROM schema_migrations")).rows.map(
      (r: { name: string; checksum: string }) => [r.name, r.checksum]
    )
  );

  const ran: string[] = [];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = applied.get(file);
    if (existing !== undefined) {
      if (existing !== checksum) {
        throw new Error(`Migration ${file} was modified after being applied (checksum mismatch)`);
      }
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [file, checksum]);
      await client.query("COMMIT");
      ran.push(file);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
  return ran;
}

if (require.main === module) {
  (async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const ran = await migrate(client);
      console.info(ran.length === 0 ? "No pending migrations." : `Applied: ${ran.join(", ")}`);
    } finally {
      await client.end();
    }
  })().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
