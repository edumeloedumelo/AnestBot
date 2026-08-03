import { BadRequestException, Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { DbService } from "../db/db.service";

export type OrgUnitKind = "organization" | "unit" | "sector" | "room" | "bed";

export type OrgUnit = {
  id: string;
  parentId: string | null;
  kind: OrgUnitKind;
  name: string;
  active: boolean;
};

@Injectable()
export class OrganizationService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService
  ) {}

  async create(input: {
    tenantId: string;
    kind: OrgUnitKind;
    name: string;
    parentId?: string | null;
    createdBy?: string | null;
  }): Promise<OrgUnit> {
    return this.db.withTenant(input.tenantId, async (client) => {
      if (input.parentId) {
        const parent = await client.query("SELECT 1 FROM org_unit WHERE id = $1", [input.parentId]);
        if (!parent.rowCount) {
          throw new BadRequestException("Parent org unit not found in this organization");
        }
      }
      const inserted = await client.query(
        `INSERT INTO org_unit (tenant_id, parent_id, kind, name)
         VALUES ($1, $2, $3, $4) RETURNING id, parent_id, kind, name, active`,
        [input.tenantId, input.parentId ?? null, input.kind, input.name]
      );
      const row = inserted.rows[0];
      await this.audit.append(client, {
        tenantId: input.tenantId,
        actorId: input.createdBy ?? null,
        action: "org_unit.created",
        entityType: "org_unit",
        entityId: row.id,
        data: { kind: input.kind, name: input.name, parentId: input.parentId ?? null },
      });
      return { id: row.id, parentId: row.parent_id, kind: row.kind, name: row.name, active: row.active };
    });
  }

  async list(tenantId: string): Promise<OrgUnit[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query(
        "SELECT id, parent_id, kind, name, active FROM org_unit ORDER BY created_at ASC"
      );
      return result.rows.map((row) => ({
        id: row.id,
        parentId: row.parent_id,
        kind: row.kind,
        name: row.name,
        active: row.active,
      }));
    });
  }
}
