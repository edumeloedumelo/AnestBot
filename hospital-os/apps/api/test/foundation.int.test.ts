/**
 * Testes de integração da Fundação (Fase 1) contra PostgreSQL real:
 * - migrations aplicam do zero e são idempotentes;
 * - trilha de auditoria é append-only (UPDATE/DELETE bloqueados no banco);
 * - hash chain detecta adulteração;
 * - RLS isola tenants;
 * - autenticação: senha, MFA TOTP, papéis, eventos auditados;
 * - acesso emergencial exige justificativa e é auditado.
 *
 * Requer um PostgreSQL acessível pelas variáveis PG* padrão. O banco
 * TEST_DB é recriado a cada execução. Dados 100% sintéticos.
 */
import { Test } from "@nestjs/testing";
import { UnauthorizedException } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { authenticator } from "otplib";
import { Client } from "pg";
import { migrate } from "../../../packages/database/src/migrate";
import { bootstrapTestDatabase } from "./helpers";
import { AuditService } from "../src/audit/audit.service";
import { DbService } from "../src/db/db.service";
import { AuthService } from "../src/identity/auth.service";
import { UsersService } from "../src/identity/users.service";
import { OrganizationService } from "../src/organization/organization.service";

const TEST_DB = "hospital_os_test";

let db: DbService;
let audit: AuditService;
let users: UsersService;
let auth: AuthService;
let organization: OrganizationService;
let admin: Client; // conexão fora do Nest para preparar/tamper
let tenantA: string;
let tenantB: string;

beforeAll(async () => {
  const bootstrapped = await bootstrapTestDatabase(TEST_DB);
  admin = bootstrapped.admin;
  expect(bootstrapped.applied.length).toBeGreaterThanOrEqual(5);
  const second = await migrate(admin);
  expect(second).toEqual([]); // idempotente

  const tenants = await admin.query(
    `INSERT INTO tenant (name, slug) VALUES
       ('Hospital Sintético A', 'hospital-a'),
       ('Clínica Sintética B', 'clinica-b')
     RETURNING id`
  );
  tenantA = tenants.rows[0].id;
  tenantB = tenants.rows[1].id;

  const moduleRef = await Test.createTestingModule({
    imports: [JwtModule.register({ secret: process.env.JWT_SECRET, signOptions: { expiresIn: "15m" } })],
    providers: [DbService, AuditService, UsersService, AuthService, OrganizationService],
  }).compile();

  db = moduleRef.get(DbService);
  audit = moduleRef.get(AuditService);
  users = moduleRef.get(UsersService);
  auth = moduleRef.get(AuthService);
  organization = moduleRef.get(OrganizationService);
});

afterAll(async () => {
  await db?.pool.end();
  await admin?.end();
});

describe("trilha de auditoria", () => {
  test("registra eventos com hash encadeado válido", async () => {
    await audit.record({ tenantId: tenantA, action: "test.first", entityType: "test" });
    await audit.record({ tenantId: tenantA, action: "test.second", entityType: "test", data: { b: 2, a: 1 } });
    await audit.record({ tenantId: tenantA, action: "test.third", entityType: "test" });
    const result = await audit.verifyChain(tenantA);
    expect(result).toEqual({ valid: true });
  });

  test("UPDATE e DELETE são bloqueados no banco, mesmo para o dono da tabela", async () => {
    await admin.query(`SET app.tenant_id = '${tenantA}'`);
    await expect(admin.query("UPDATE audit_event SET action = 'tampered' WHERE tenant_id = $1", [tenantA])).rejects.toThrow(
      /append-only/
    );
    await expect(admin.query("DELETE FROM audit_event WHERE tenant_id = $1", [tenantA])).rejects.toThrow(/append-only/);
    await admin.query("RESET app.tenant_id");
  });

  test("adulteração forçada (trigger desabilitado) é detectada pelo verifyChain", async () => {
    await admin.query(`SET app.tenant_id = '${tenantA}'`);
    await admin.query("ALTER TABLE audit_event DISABLE TRIGGER audit_event_no_update");
    const tampered = await admin.query(
      `UPDATE audit_event SET data = '{"tampered": true}'::jsonb
       WHERE tenant_id = $1 AND action = 'test.second' RETURNING seq`,
      [tenantA]
    );
    await admin.query("ALTER TABLE audit_event ENABLE TRIGGER audit_event_no_update");
    await admin.query("RESET app.tenant_id");

    const result = await audit.verifyChain(tenantA);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSeq).toBe(Number(tampered.rows[0].seq));
  });
});

describe("isolamento de tenant (RLS)", () => {
  test("consultas sob o tenant A não enxergam dados do tenant B", async () => {
    await users.createUser({ tenantId: tenantA, email: "ana@a.test", fullName: "Ana Sintética", password: "senha-forte-1" });
    await users.createUser({ tenantId: tenantB, email: "bia@b.test", fullName: "Bia Sintética", password: "senha-forte-2" });

    const visibleFromA = await db.withTenant(tenantA, async (client) => {
      const rows = await client.query("SELECT email FROM app_user");
      return rows.rows.map((r) => r.email);
    });
    expect(visibleFromA).toEqual(["ana@a.test"]);
  });

  test("escrita com tenant_id de outro tenant é rejeitada pela política", async () => {
    await expect(
      db.withTenant(tenantA, (client) =>
        client.query("INSERT INTO app_user (tenant_id, email, full_name, password_hash) VALUES ($1, 'x@b.test', 'X', 'h')", [
          tenantB,
        ])
      )
    ).rejects.toThrow(/row-level security/);
  });
});

describe("autenticação e autorização", () => {
  let userId: string;

  beforeAll(async () => {
    const created = await users.createUser({
      tenantId: tenantA,
      email: "medico@a.test",
      fullName: "Médico Sintético",
      password: "senha-muito-forte",
    });
    userId = created.id;
    await users.assignRole({ tenantId: tenantA, userId, role: "anesthesiologist" });
  });

  test("login com senha correta emite token com papéis vigentes", async () => {
    const result = await auth.login({ tenantId: tenantA, email: "medico@a.test", password: "senha-muito-forte" });
    expect(result.accessToken).toBeTruthy();
    expect(result.user.roles).toEqual(["anesthesiologist"]);
  });

  test("login com senha errada falha e gera evento auditado", async () => {
    await expect(auth.login({ tenantId: tenantA, email: "medico@a.test", password: "errada-errada" })).rejects.toThrow(
      UnauthorizedException
    );
    const events = await db.withTenant(tenantA, (client) =>
      client.query("SELECT 1 FROM audit_event WHERE action = 'auth.login_failed' AND actor_id = $1", [userId])
    );
    expect(events.rowCount).toBeGreaterThanOrEqual(1);
  });

  test("com MFA ativado, login exige código TOTP válido", async () => {
    const { otpauthUrl } = await auth.enrollMfa(tenantA, userId);
    const secret = new URL(otpauthUrl).searchParams.get("secret")!;
    await auth.activateMfa(tenantA, userId, authenticator.generate(secret));

    await expect(auth.login({ tenantId: tenantA, email: "medico@a.test", password: "senha-muito-forte" })).rejects.toThrow(
      UnauthorizedException
    );
    const result = await auth.login({
      tenantId: tenantA,
      email: "medico@a.test",
      password: "senha-muito-forte",
      totpCode: authenticator.generate(secret),
    });
    expect(result.user.userId).toBe(userId);
  });

  test("acesso emergencial exige justificativa e fica auditado", async () => {
    const { auditSeq } = await auth.emergencyAccess({
      tenantId: tenantA,
      userId,
      role: "anesthesiologist",
      resourceType: "patient",
      resourceId: "paciente-sintetico-1",
      justification: "Paciente inconsciente na emergência, acesso necessário para alergias.",
    });
    const event = await db.withTenant(tenantA, (client) =>
      client.query("SELECT action, justification FROM audit_event WHERE seq = $1", [auditSeq])
    );
    expect(event.rows[0].action).toBe("access.emergency_granted");
    expect(event.rows[0].justification).toContain("emergência");
  });
});

describe("estrutura organizacional", () => {
  test("cria hierarquia, lista por tenant e audita a criação", async () => {
    const org = await organization.create({ tenantId: tenantA, kind: "organization", name: "Hospital Sintético A" });
    const unit = await organization.create({ tenantId: tenantA, kind: "unit", name: "Centro Cirúrgico", parentId: org.id });
    await organization.create({ tenantId: tenantA, kind: "room", name: "Sala 1", parentId: unit.id });

    const listed = await organization.list(tenantA);
    expect(listed.map((u) => u.name)).toEqual(["Hospital Sintético A", "Centro Cirúrgico", "Sala 1"]);
    expect(await organization.list(tenantB)).toEqual([]);

    const audited = await db.withTenant(tenantA, (client) =>
      client.query("SELECT 1 FROM audit_event WHERE action = 'org_unit.created'")
    );
    expect(audited.rowCount).toBe(3);
  });

  test("a cadeia de auditoria do tenant B permanece válida e independente", async () => {
    expect(await audit.verifyChain(tenantB)).toEqual({ valid: true });
  });
});
