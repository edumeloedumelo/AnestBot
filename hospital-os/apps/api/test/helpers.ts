import { Client } from "pg";
import { migrate } from "../../../packages/database/src/migrate";

/**
 * Bootstrap de banco de teste: recria o banco, aplica migrations como
 * superusuário e cria um usuário de aplicação SEM bypass de RLS (membro de
 * hospital_os_app), que passa a ser a identidade das conexões do DbService
 * via variáveis de ambiente. Espelha a topologia de produção.
 */
const APP_LOGIN = "hospital_os_app_test";

// Captura o usuário administrador uma única vez por processo, antes de o
// PGUSER ser apontado para o usuário de aplicação.
const ADMIN_USER = (process.env.PG_ADMIN_USER ??= process.env.PGUSER ?? "postgres");

export async function bootstrapTestDatabase(dbName: string): Promise<{ admin: Client; applied: string[] }> {
  const bootstrap = new Client({ database: "postgres", user: ADMIN_USER });
  await bootstrap.connect();
  await bootstrap.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await bootstrap.query(`CREATE DATABASE ${dbName}`);
  await bootstrap.query(`DROP ROLE IF EXISTS ${APP_LOGIN}`);
  await bootstrap.end();

  const admin = new Client({ database: dbName, user: ADMIN_USER });
  await admin.connect();
  const applied = await migrate(admin);
  await admin.query(`CREATE ROLE ${APP_LOGIN} LOGIN PASSWORD 'test-only' IN ROLE hospital_os_app`);

  process.env.JWT_SECRET = "test-secret-do-not-use-in-production";
  process.env.PGDATABASE = dbName;
  process.env.PGUSER = APP_LOGIN;
  process.env.PGPASSWORD = "test-only";

  return { admin, applied };
}
