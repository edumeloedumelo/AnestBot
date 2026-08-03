import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import { AuditService } from "../audit/audit.service";
import { DbService } from "../db/db.service";
import { Role, UsersService } from "./users.service";

export type AuthenticatedUser = {
  userId: string;
  tenantId: string;
  fullName: string;
  roles: Role[];
};

/**
 * Autenticação com MFA TOTP e sessões JWT curtas (SECURITY.md §2).
 * Sucesso e falha de login são auditados; mensagens de erro não revelam se o
 * e-mail existe.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService
  ) {}

  async login(input: {
    tenantId: string;
    email: string;
    password: string;
    totpCode?: string;
    sourceIp?: string;
  }): Promise<{ accessToken: string; user: AuthenticatedUser }> {
    const failure = async (reason: string, userId?: string) => {
      await this.audit.record({
        tenantId: input.tenantId,
        actorId: userId ?? null,
        action: "auth.login_failed",
        entityType: "app_user",
        entityId: userId ?? null,
        data: { email: input.email.toLowerCase(), reason },
        sourceIp: input.sourceIp ?? null,
      });
      return new UnauthorizedException("Invalid credentials");
    };

    return this.db.withTenant(input.tenantId, async (client) => {
      const user = await this.users.findByEmail(client, input.tenantId, input.email);
      if (!user || !user.active) {
        throw await failure("unknown_or_inactive_user");
      }
      const passwordOk = await bcrypt.compare(input.password, user.password_hash);
      if (!passwordOk) {
        throw await failure("wrong_password", user.id);
      }
      if (user.mfa_enabled) {
        if (!input.totpCode || !user.mfa_secret || !authenticator.check(input.totpCode, user.mfa_secret)) {
          throw await failure("mfa_failed", user.id);
        }
      }
      const roles = await this.users.activeRoles(client, input.tenantId, user.id);
      await this.audit.append(client, {
        tenantId: input.tenantId,
        actorId: user.id,
        action: "auth.login_succeeded",
        entityType: "app_user",
        entityId: user.id,
        data: { mfaUsed: user.mfa_enabled },
        sourceIp: input.sourceIp ?? null,
      });
      const accessToken = await this.jwt.signAsync({
        sub: user.id,
        tenant: input.tenantId,
        name: user.full_name,
        roles,
      });
      return { accessToken, user: { userId: user.id, tenantId: input.tenantId, fullName: user.full_name, roles } };
    });
  }

  /** Gera segredo TOTP; MFA só ativa após o usuário provar posse (activateMfa). */
  async enrollMfa(tenantId: string, userId: string): Promise<{ otpauthUrl: string }> {
    const secret = authenticator.generateSecret();
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query(
        "UPDATE app_user SET mfa_secret = $1, mfa_enabled = false WHERE tenant_id = $2 AND id = $3 RETURNING email",
        [secret, tenantId, userId]
      );
      if (!result.rowCount) {
        throw new UnauthorizedException("User not found");
      }
      await this.audit.append(client, {
        tenantId,
        actorId: userId,
        action: "auth.mfa_enrolled",
        entityType: "app_user",
        entityId: userId,
      });
      const email: string = result.rows[0].email;
      return { otpauthUrl: authenticator.keyuri(email, "Hospital OS", secret) };
    });
  }

  async activateMfa(tenantId: string, userId: string, code: string): Promise<void> {
    await this.db.withTenant(tenantId, async (client) => {
      const result = await client.query("SELECT mfa_secret FROM app_user WHERE tenant_id = $1 AND id = $2", [
        tenantId,
        userId,
      ]);
      const secret: string | null = result.rows[0]?.mfa_secret ?? null;
      if (!secret || !authenticator.check(code, secret)) {
        throw new UnauthorizedException("Invalid MFA code");
      }
      await client.query("UPDATE app_user SET mfa_enabled = true WHERE tenant_id = $1 AND id = $2", [tenantId, userId]);
      await this.audit.append(client, {
        tenantId,
        actorId: userId,
        action: "auth.mfa_activated",
        entityType: "app_user",
        entityId: userId,
      });
    });
  }

  /**
   * Acesso emergencial ("break the glass", SECURITY.md §2): concedido apenas
   * com justificativa, sempre auditado como evento distinto para revisão
   * posterior obrigatória.
   */
  async emergencyAccess(input: {
    tenantId: string;
    userId: string;
    role: string;
    resourceType: string;
    resourceId: string;
    justification: string;
    sourceIp?: string;
  }): Promise<{ auditSeq: number }> {
    const { seq } = await this.audit.record({
      tenantId: input.tenantId,
      actorId: input.userId,
      actorRole: input.role,
      action: "access.emergency_granted",
      entityType: input.resourceType,
      entityId: input.resourceId,
      justification: input.justification,
      sourceIp: input.sourceIp ?? null,
    });
    return { auditSeq: seq };
  }
}
