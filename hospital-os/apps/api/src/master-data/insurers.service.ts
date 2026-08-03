import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { DbService } from "../db/db.service";

export type Insurer = { id: string; name: string; ansCode: string | null; active: boolean };

function rowToInsurer(row: Record<string, unknown>): Insurer {
  return {
    id: row.id as string,
    name: row.name as string,
    ansCode: (row.ans_code as string) ?? null,
    active: row.active as boolean,
  };
}

@Injectable()
export class InsurersService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService
  ) {}

  async create(input: { tenantId: string; name: string; ansCode?: string; createdBy?: string | null }): Promise<Insurer> {
    return this.db.withTenant(input.tenantId, async (client) => {
      const existing = await client.query("SELECT 1 FROM insurer WHERE name = $1", [input.name.trim()]);
      if (existing.rowCount) {
        throw new ConflictException("Convênio com este nome já cadastrado");
      }
      const inserted = await client.query(
        "INSERT INTO insurer (tenant_id, name, ans_code) VALUES ($1, $2, $3) RETURNING *",
        [input.tenantId, input.name.trim(), input.ansCode ?? null]
      );
      const insurer = rowToInsurer(inserted.rows[0]);
      await this.audit.append(client, {
        tenantId: input.tenantId,
        actorId: input.createdBy ?? null,
        action: "insurer.created",
        entityType: "insurer",
        entityId: insurer.id,
        data: { name: insurer.name, ansCode: insurer.ansCode },
      });
      return insurer;
    });
  }

  async list(tenantId: string, includeInactive = false): Promise<Insurer[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM insurer WHERE $1 OR active ORDER BY name ASC`,
        [includeInactive]
      );
      return result.rows.map(rowToInsurer);
    });
  }

  /** Desativação auditada — convênios não são apagados (histórico de contas). */
  async deactivate(input: { tenantId: string; insurerId: string; deactivatedBy?: string | null }): Promise<void> {
    await this.db.withTenant(input.tenantId, async (client) => {
      const result = await client.query("UPDATE insurer SET active = false WHERE id = $1 RETURNING name", [
        input.insurerId,
      ]);
      if (!result.rowCount) {
        throw new NotFoundException("Convênio não encontrado");
      }
      await this.audit.append(client, {
        tenantId: input.tenantId,
        actorId: input.deactivatedBy ?? null,
        action: "insurer.deactivated",
        entityType: "insurer",
        entityId: input.insurerId,
        data: { name: result.rows[0].name },
      });
    });
  }
}
