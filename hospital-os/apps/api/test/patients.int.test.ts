/**
 * Testes de integração do cadastro de pacientes com deduplicação (F1-E5)
 * contra PostgreSQL real. Dados 100% sintéticos.
 */
import { Test } from "@nestjs/testing";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { Client } from "pg";
import { bootstrapTestDatabase } from "./helpers";
import { AuditService } from "../src/audit/audit.service";
import { DbService } from "../src/db/db.service";
import { PatientsService } from "../src/patients/patients.service";

const TEST_DB = "hospital_os_test_patients";

let admin: Client;
let db: DbService;
let patients: PatientsService;
let tenantA: string;
let tenantB: string;

// CPF sintético com dígitos verificadores válidos.
const CPF_1 = "52998224725";

beforeAll(async () => {
  const bootstrapped = await bootstrapTestDatabase(TEST_DB);
  admin = bootstrapped.admin;

  const tenants = await admin.query(
    `INSERT INTO tenant (name, slug) VALUES
       ('Hospital Sintético A', 'hospital-a'),
       ('Clínica Sintética B', 'clinica-b')
     RETURNING id`
  );
  tenantA = tenants.rows[0].id;
  tenantB = tenants.rows[1].id;

  const moduleRef = await Test.createTestingModule({
    providers: [DbService, AuditService, PatientsService],
  }).compile();
  db = moduleRef.get(DbService);
  patients = moduleRef.get(PatientsService);
});

afterAll(async () => {
  await db?.pool.end();
  await admin?.end();
});

describe("criação e prontuário", () => {
  test("cria paciente com prontuário sequencial por tenant e evento auditado", async () => {
    const first = await patients.create({
      tenantId: tenantA,
      fullName: "Maria Aparecida de Souza (fictício)",
      birthDate: "1958-03-12",
      sex: "F",
      cpf: CPF_1,
    });
    expect(first.mrn).toBe("000001");

    const second = await patients.create({
      tenantId: tenantA,
      fullName: "Carlos Eduardo Ramos (fictício)",
      birthDate: "1950-01-30",
      sex: "M",
    });
    expect(second.mrn).toBe("000002");

    const other = await patients.create({
      tenantId: tenantB,
      fullName: "Paciente Da Clínica B (fictício)",
      birthDate: "1990-05-05",
    });
    expect(other.mrn).toBe("000001"); // sequência independente por tenant

    const audited = await db.withTenant(tenantA, (client) =>
      client.query("SELECT 1 FROM audit_event WHERE action = 'patient.created'")
    );
    expect(audited.rowCount).toBe(2);
  });

  test("CPF com dígito verificador errado é rejeitado", async () => {
    await expect(
      patients.create({ tenantId: tenantA, fullName: "Teste CPF", birthDate: "2000-01-01", cpf: "52998224724" })
    ).rejects.toThrow(BadRequestException);
  });
});

describe("deduplicação", () => {
  test("mesmo CPF é apontado como duplicidade", async () => {
    const candidates = await patients.findDuplicates({
      tenantId: tenantA,
      fullName: "Nome Completamente Diferente",
      birthDate: "1999-09-09",
      cpf: CPF_1,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].reasons).toContain("same_cpf");
  });

  test("nome semelhante + mesma data de nascimento é apontado (Souza/Sousa, com/sem partícula)", async () => {
    const candidates = await patients.findDuplicates({
      tenantId: tenantA,
      fullName: "Maria Aparecida Sousa (fictício)",
      birthDate: "1958-03-12",
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].reasons).toContain("similar_name_same_birth_date");
    expect(candidates[0].nameScore).toBeGreaterThanOrEqual(0.7);
  });

  test("mesma data de nascimento com nome diferente NÃO é duplicidade", async () => {
    const candidates = await patients.findDuplicates({
      tenantId: tenantA,
      fullName: "Roberto Nogueira Braga (fictício)",
      birthDate: "1958-03-12",
    });
    expect(candidates).toHaveLength(0);
  });

  test("criação com duplicidade candidata é bloqueada sem justificativa", async () => {
    await expect(
      patients.create({
        tenantId: tenantA,
        fullName: "Maria Aparecida Sousa (fictício)",
        birthDate: "1958-03-12",
      })
    ).rejects.toThrow(ConflictException);
  });

  test("criação com justificativa registra a decisão na auditoria", async () => {
    const created = await patients.create({
      tenantId: tenantA,
      fullName: "Maria Aparecida Sousa (fictício)",
      birthDate: "1958-03-12",
      duplicateOverrideJustification: "Confirmado com documento: são pessoas homônimas distintas.",
    });
    expect(created.mrn).toBe("000003");

    const audited = await db.withTenant(tenantA, (client) =>
      client.query(
        `SELECT justification, data FROM audit_event
         WHERE action = 'patient.created' AND entity_id = $1`,
        [created.id]
      )
    );
    expect(audited.rows[0].justification).toContain("homônimas");
    expect(audited.rows[0].data.duplicateCandidatesOverridden).toHaveLength(1);
  });
});

describe("busca e isolamento", () => {
  test("busca por fragmento de nome, prontuário e CPF", async () => {
    expect((await patients.search(tenantA, "aparecida")).length).toBeGreaterThanOrEqual(2);
    expect((await patients.search(tenantA, "000002"))[0].fullName).toContain("Carlos Eduardo");
    expect((await patients.search(tenantA, "529.982.247-25"))[0].mrn).toBe("000001");
  });

  test("pacientes de outro tenant não aparecem (RLS)", async () => {
    expect(await patients.search(tenantB, "aparecida")).toEqual([]);
  });
});

describe("mesclagem auditada", () => {
  test("origem fica inativa apontando para o sobrevivente; nada é apagado", async () => {
    const [original] = await patients.search(tenantA, "000001");
    const [duplicate] = await patients.search(tenantA, "000003");

    const { survivor } = await patients.merge({
      tenantId: tenantA,
      sourceId: duplicate.id,
      targetId: original.id,
      justification: "Cadastro 000003 confirmado como duplicidade do 000001 após conferência.",
    });
    expect(survivor.id).toBe(original.id);

    const source = await patients.get(tenantA, duplicate.id);
    expect(source.active).toBe(false);
    expect(source.mergedInto).toBe(original.id);

    // Inativo sai da busca, mas o registro continua acessível por id.
    expect(await patients.search(tenantA, "000003")).toEqual([]);

    const audited = await db.withTenant(tenantA, (client) =>
      client.query("SELECT justification FROM audit_event WHERE action = 'patient.merged' AND entity_id = $1", [
        duplicate.id,
      ])
    );
    expect(audited.rowCount).toBe(1);
  });

  test("mesclagem sem justificativa mínima é rejeitada", async () => {
    const [a] = await patients.search(tenantA, "000001");
    const [b] = await patients.search(tenantA, "000002");
    await expect(
      patients.merge({ tenantId: tenantA, sourceId: b.id, targetId: a.id, justification: "curta" })
    ).rejects.toThrow(BadRequestException);
  });
});
