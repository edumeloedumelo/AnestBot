import { ConflictException, Injectable } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { PoolClient } from "pg";
import { AuditService } from "../audit/audit.service";
import { DbService } from "../db/db.service";

export type Role =
  | "admin"
  | "physician"
  | "anesthesiologist"
  | "surgeon"
  | "nurse"
  | "pharmacist"
  | "reception"
  | "billing"
  | "auditor";

export type UserRow = {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string;
  password_hash: string;
  mfa_secret: string | null;
  mfa_enabled: boolean;
  active: boolean;
};

const BCRYPT_ROUNDS = 12;

@Injectable()
export class UsersService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService
  ) {}

  async createUser(input: {
    tenantId: string;
    email: string;
    fullName: string;
    password: string;
    createdBy?: string | null;
  }): Promise<{ id: string }> {
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    return this.db.withTenant(input.tenantId, async (client) => {
      const existing = await client.query("SELECT 1 FROM app_user WHERE tenant_id = $1 AND email = $2", [
        input.tenantId,
        input.email.toLowerCase(),
      ]);
      if (existing.rowCount) {
        throw new ConflictException("User with this email already exists in this organization");
      }
      const inserted = await client.query(
        `INSERT INTO app_user (tenant_id, email, full_name, password_hash)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [input.tenantId, input.email.toLowerCase(), input.fullName, passwordHash]
      );
      const id: string = inserted.rows[0].id;
      await this.audit.append(client, {
        tenantId: input.tenantId,
        actorId: input.createdBy ?? null,
        action: "user.created",
        entityType: "app_user",
        entityId: id,
        data: { email: input.email.toLowerCase(), fullName: input.fullName },
      });
      return { id };
    });
  }

  async assignRole(input: {
    tenantId: string;
    userId: string;
    role: Role;
    orgUnitId?: string | null;
    assignedBy?: string | null;
  }): Promise<{ id: string }> {
    return this.db.withTenant(input.tenantId, async (client) => {
      const inserted = await client.query(
        `INSERT INTO role_assignment (tenant_id, user_id, role, org_unit_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [input.tenantId, input.userId, input.role, input.orgUnitId ?? null]
      );
      const id: string = inserted.rows[0].id;
      await this.audit.append(client, {
        tenantId: input.tenantId,
        actorId: input.assignedBy ?? null,
        action: "role.assigned",
        entityType: "role_assignment",
        entityId: id,
        data: { userId: input.userId, role: input.role, orgUnitId: input.orgUnitId ?? null },
      });
      return { id };
    });
  }

  async findByEmail(client: PoolClient, tenantId: string, email: string): Promise<UserRow | null> {
    const result = await client.query("SELECT * FROM app_user WHERE tenant_id = $1 AND email = $2", [
      tenantId,
      email.toLowerCase(),
    ]);
    return (result.rows[0] as UserRow) ?? null;
  }

  /** Papéis vigentes agora (valid_from <= now < valid_to). */
  async activeRoles(client: PoolClient, tenantId: string, userId: string): Promise<Role[]> {
    const result = await client.query(
      `SELECT DISTINCT role FROM role_assignment
       WHERE tenant_id = $1 AND user_id = $2
         AND valid_from <= now() AND (valid_to IS NULL OR valid_to > now())`,
      [tenantId, userId]
    );
    return result.rows.map((r: { role: Role }) => r.role);
  }
}
