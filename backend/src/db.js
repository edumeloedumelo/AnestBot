// Pool de conexão Postgres — fonte única de verdade de tenants, cobrança e uso.
import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export async function query(text, params) {
  return pool.query(text, params);
}

// Executa uma função dentro de uma transação, fazendo rollback automático em erro.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
