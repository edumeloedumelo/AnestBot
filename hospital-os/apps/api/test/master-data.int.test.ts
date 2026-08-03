/**
 * Testes de integração dos cadastros mestres (F1-E4) contra PostgreSQL real:
 * importação de procedimentos com vigência (supersede, nunca sobrescreve),
 * constraint de não-sobreposição no banco, busca por data de vigência,
 * convênios auditados. Dados 100% sintéticos.
 */
import { Test } from "@nestjs/testing";
import { ConflictException } from "@nestjs/common";
import { Client } from "pg";
import { bootstrapTestDatabase } from "./helpers";
import { AuditService } from "../src/audit/audit.service";
import { DbService } from "../src/db/db.service";
import { InsurersService } from "../src/master-data/insurers.service";
import { ProceduresService } from "../src/master-data/procedures.service";

const TEST_DB = "hospital_os_test_masterdata";

let admin: Client;
let db: DbService;
let procedures: ProceduresService;
let insurers: InsurersService;
let tenantA: string;

beforeAll(async () => {
  const bootstrapped = await bootstrapTestDatabase(TEST_DB);
  admin = bootstrapped.admin;
  const tenants = await admin.query(
    "INSERT INTO tenant (name, slug) VALUES ('Hospital Sintético A', 'hospital-a') RETURNING id"
  );
  tenantA = tenants.rows[0].id;

  const moduleRef = await Test.createTestingModule({
    providers: [DbService, AuditService, ProceduresService, InsurersService],
  }).compile();
  db = moduleRef.get(DbService);
  procedures = moduleRef.get(ProceduresService);
  insurers = moduleRef.get(InsurersService);
});

afterAll(async () => {
  await db?.pool.end();
  await admin?.end();
});

describe("importação de procedimentos com vigência", () => {
  test("primeira importação insere e audita o lote", async () => {
    const summary = await procedures.import({
      tenantId: tenantA,
      source: "TUSS sintética 2026-01",
      rows: [
        { codeSystem: "TUSS", code: "31005497", description: "Colecistectomia videolaparoscópica", validFrom: "2026-01-01" },
        { codeSystem: "TUSS", code: "30731063", description: "Artroscopia de joelho", validFrom: "2026-01-01" },
        { codeSystem: "CBHPM", code: "3.10.05.49-7", description: "Colecistectomia videolaparoscópica", validFrom: "2026-01-01" },
      ],
    });
    expect(summary).toEqual({ inserted: 3, superseded: 0, skipped: 0 });

    const audited = await db.withTenant(tenantA, (client) =>
      client.query("SELECT data FROM audit_event WHERE action = 'procedure_table.imported'")
    );
    expect(audited.rowCount).toBe(1);
    expect(audited.rows[0].data.source).toBe("TUSS sintética 2026-01");
  });

  test("reimportação idêntica não duplica (skipped)", async () => {
    const summary = await procedures.import({
      tenantId: tenantA,
      source: "TUSS sintética 2026-01 (repetida)",
      rows: [
        { codeSystem: "TUSS", code: "31005497", description: "Colecistectomia videolaparoscópica", validFrom: "2026-06-01" },
      ],
    });
    expect(summary).toEqual({ inserted: 0, superseded: 0, skipped: 1 });
  });

  test("descrição alterada SUPERSEDE a vigência anterior sem apagar histórico", async () => {
    const summary = await procedures.import({
      tenantId: tenantA,
      source: "TUSS sintética 2026-07",
      rows: [
        {
          codeSystem: "TUSS",
          code: "31005497",
          description: "Colecistectomia por videolaparoscopia (redação revisada)",
          validFrom: "2026-07-01",
        },
      ],
    });
    expect(summary).toEqual({ inserted: 1, superseded: 1, skipped: 0 });

    // Na data antiga vale a descrição antiga; na nova, a revisada.
    const before = await procedures.search(tenantA, "31005497", "2026-03-15");
    expect(before[0].description).toBe("Colecistectomia videolaparoscópica");
    const after = await procedures.search(tenantA, "31005497", "2026-08-01");
    expect(after[0].description).toBe("Colecistectomia por videolaparoscopia (redação revisada)");

    const history = await procedures.history(tenantA, "TUSS", "31005497");
    expect(history).toHaveLength(2);
    expect(history[0].validTo).toBe("2026-07-01");
    expect(history[1].validTo).toBeNull();
  });

  test("vigências sobrepostas são impossíveis mesmo por INSERT direto (constraint)", async () => {
    await expect(
      db.withTenant(tenantA, (client) =>
        client.query(
          `INSERT INTO procedure_code (tenant_id, code_system, code, description, valid_from)
           VALUES ($1, 'TUSS', '31005497', 'Sobreposição indevida', '2026-09-01')`,
          [tenantA]
        )
      )
    ).rejects.toThrow(/procedure_code_no_overlap/);
  });

  test("busca por descrição respeita a vigência na data", async () => {
    const results = await procedures.search(tenantA, "artroscopia", "2026-08-01");
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("30731063");
    expect(await procedures.search(tenantA, "artroscopia", "2025-12-31")).toEqual([]);
  });
});

describe("convênios", () => {
  test("cria com auditoria, rejeita duplicado e lista ativos", async () => {
    const insurer = await insurers.create({ tenantId: tenantA, name: "Unimed Teste", ansCode: "123456" });
    await insurers.create({ tenantId: tenantA, name: "Bradesco Teste" });
    await expect(insurers.create({ tenantId: tenantA, name: "Unimed Teste" })).rejects.toThrow(ConflictException);

    await insurers.deactivate({ tenantId: tenantA, insurerId: insurer.id });
    expect((await insurers.list(tenantA)).map((i) => i.name)).toEqual(["Bradesco Teste"]);
    expect((await insurers.list(tenantA, true)).map((i) => i.name)).toEqual(["Bradesco Teste", "Unimed Teste"]);

    const audited = await db.withTenant(tenantA, (client) =>
      client.query("SELECT action FROM audit_event WHERE entity_type = 'insurer' ORDER BY seq ASC")
    );
    expect(audited.rows.map((r) => r.action)).toEqual(["insurer.created", "insurer.created", "insurer.deactivated"]);
  });
});
