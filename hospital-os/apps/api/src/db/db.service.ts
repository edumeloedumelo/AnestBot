import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool, PoolClient } from "pg";

/**
 * Acesso a dados com isolamento de tenant por RLS (ADR-009).
 * Toda operação de domínio roda dentro de withTenant(): uma transação com
 * `app.tenant_id` definido, que as políticas RLS usam para filtrar linhas.
 * Não há caminho de consulta de domínio fora de um contexto de tenant.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor() {
    // Configuração via variáveis de ambiente padrão do pg / DATABASE_URL.
    this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }

  async withTenant<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
