/**
 * Testes de integração do domínio cirúrgico (F2-E1/E2/E3) contra PostgreSQL
 * real: solicitação com validações estruturais, agendamento com conflito de
 * sala impossível (constraint) e conflito de equipe detectado, confirmação
 * bloqueada por itens críticos, jornada de status com transições válidas e
 * cancelamento com causa. Dados 100% sintéticos.
 */
import { Test } from "@nestjs/testing";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { Client } from "pg";
import { bootstrapTestDatabase } from "./helpers";
import { AuditService } from "../src/audit/audit.service";
import { DbService } from "../src/db/db.service";
import { OrganizationService } from "../src/organization/organization.service";
import { PatientsService } from "../src/patients/patients.service";
import { ProceduresService } from "../src/master-data/procedures.service";
import { SurgeryService } from "../src/surgery/surgery.service";

const TEST_DB = "hospital_os_test_surgery";

let admin: Client;
let db: DbService;
let surgery: SurgeryService;
let tenantA: string;
let patientId: string;
let procedureId: string;
let room1: string;
let room2: string;

const TEAM = [
  { name: "Dr. Teste Andrade", role: "surgeon" as const },
  { name: "Dr. Teste Melo", role: "anesthesiologist" as const },
];

beforeAll(async () => {
  const bootstrapped = await bootstrapTestDatabase(TEST_DB);
  admin = bootstrapped.admin;
  tenantA = (
    await admin.query("INSERT INTO tenant (name, slug) VALUES ('Hospital Sintético A', 'hospital-a') RETURNING id")
  ).rows[0].id;

  const moduleRef = await Test.createTestingModule({
    providers: [DbService, AuditService, PatientsService, ProceduresService, OrganizationService, SurgeryService],
  }).compile();
  db = moduleRef.get(DbService);
  surgery = moduleRef.get(SurgeryService);

  const patients = moduleRef.get(PatientsService);
  patientId = (
    await patients.create({ tenantId: tenantA, fullName: "Paciente Cirúrgico (fictício)", birthDate: "1970-04-02" })
  ).id;

  const procedures = moduleRef.get(ProceduresService);
  await procedures.import({
    tenantId: tenantA,
    source: "TUSS sintética",
    rows: [{ codeSystem: "TUSS", code: "31005497", description: "Colecistectomia videolaparoscópica", validFrom: "2020-01-01" }],
  });
  procedureId = (await procedures.search(tenantA, "31005497"))[0].id;

  const organization = moduleRef.get(OrganizationService);
  const org = await organization.create({ tenantId: tenantA, kind: "organization", name: "Hospital A" });
  const cc = await organization.create({ tenantId: tenantA, kind: "unit", name: "Centro Cirúrgico", parentId: org.id });
  room1 = (await organization.create({ tenantId: tenantA, kind: "room", name: "Sala 1", parentId: cc.id })).id;
  room2 = (await organization.create({ tenantId: tenantA, kind: "room", name: "Sala 2", parentId: cc.id })).id;
});

afterAll(async () => {
  await db?.pool.end();
  await admin?.end();
});

function newRequest(overrides: Partial<Parameters<SurgeryService["createRequest"]>[0]> = {}) {
  return surgery.createRequest({
    tenantId: tenantA,
    patientId,
    laterality: "not_applicable",
    procedureCodeIds: [procedureId],
    team: TEAM,
    expectedDurationMin: 120,
    ...overrides,
  });
}

describe("solicitação cirúrgica", () => {
  test("exige cirurgião e anestesiologista na equipe", async () => {
    await expect(newRequest({ team: [{ name: "Dr. Só Cirurgião", role: "surgeon" }] })).rejects.toThrow(
      BadRequestException
    );
  });

  test("cria com procedimento vigente e registra jornada + auditoria", async () => {
    const created = await newRequest();
    expect(created.status).toBe("requested");
    const journey = await surgery.getJourney(tenantA, created.id);
    expect(journey.statusEvents.map((e: { to_status: string }) => e.to_status)).toEqual(["requested"]);
    expect(journey.procedures[0].code).toBe("31005497");
  });
});

describe("agendamento e conflitos", () => {
  test("agenda em sala; sala ocupada é rejeitada pela CONSTRAINT do banco", async () => {
    const caseA = await newRequest();
    const caseB = await newRequest({ team: [{ name: "Dra. Outra", role: "surgeon" }, { name: "Dr. Outro Anest", role: "anesthesiologist" }] });

    await surgery.schedule({
      tenantId: tenantA, caseId: caseA.id, roomId: room1,
      start: "2026-09-01T10:00:00Z", end: "2026-09-01T12:00:00Z",
    });
    await expect(
      surgery.schedule({
        tenantId: tenantA, caseId: caseB.id, roomId: room1,
        start: "2026-09-01T11:00:00Z", end: "2026-09-01T13:00:00Z",
      })
    ).rejects.toThrow(/Sala já ocupada/);

    // Sala diferente no mesmo horário: sem conflito.
    await surgery.schedule({
      tenantId: tenantA, caseId: caseB.id, roomId: room2,
      start: "2026-09-01T11:00:00Z", end: "2026-09-01T13:00:00Z",
    });
  });

  test("mesma equipe em duas salas no mesmo horário é conflito de equipe", async () => {
    const caseC = await newRequest(); // mesma TEAM do caseA (10:00–12:00, Sala 1)
    await expect(
      surgery.schedule({
        tenantId: tenantA, caseId: caseC.id, roomId: room2,
        start: "2026-09-01T09:00:00Z", end: "2026-09-01T10:30:00Z",
      })
    ).rejects.toThrow(ConflictException);

    // Horário livre da equipe: agenda normalmente.
    await surgery.schedule({
      tenantId: tenantA, caseId: caseC.id, roomId: room2,
      start: "2026-09-01T14:00:00Z", end: "2026-09-01T16:00:00Z",
    });
  });
});

describe("confirmação bloqueada por itens críticos", () => {
  test("lista exatamente o que falta e libera quando tudo está definido", async () => {
    const created = await newRequest({ team: [{ name: "Dr. C1", role: "surgeon" }, { name: "Dr. C2", role: "anesthesiologist" }] });
    await surgery.transition({ tenantId: tenantA, caseId: created.id, to: "authorized" });

    const blocked = await surgery
      .confirm({ tenantId: tenantA, caseId: created.id })
      .then(() => null)
      .catch((err: BadRequestException) => err.getResponse() as { missing: string[] });
    expect(blocked?.missing).toEqual([
      "Sala e horário agendados",
      "Situação de OPME indefinida",
      "Situação de reserva de sangue indefinida",
      "Situação de reserva de UTI indefinida",
      "Termo de consentimento não registrado",
    ]);

    await surgery.schedule({
      tenantId: tenantA, caseId: created.id, roomId: room1,
      start: "2026-09-02T08:00:00Z", end: "2026-09-02T10:00:00Z",
    });
    await surgery.updateCriticalItems({
      tenantId: tenantA, caseId: created.id,
      opmeStatus: "not_needed", bloodReserve: "not_needed", icuReserve: "not_needed", consentRegistered: true,
    });
    await surgery.confirm({ tenantId: tenantA, caseId: created.id });
    const journey = await surgery.getJourney(tenantA, created.id);
    expect(journey.case.status).toBe("confirmed");
  });
});

describe("jornada e cancelamento", () => {
  test("percorre a jornada completa; transição inválida é rejeitada", async () => {
    const created = await newRequest({ team: [{ name: "Dr. J1", role: "surgeon" }, { name: "Dr. J2", role: "anesthesiologist" }] });
    await surgery.transition({ tenantId: tenantA, caseId: created.id, to: "authorized" });

    // Pular etapas não é permitido.
    await expect(surgery.transition({ tenantId: tenantA, caseId: created.id, to: "in_room" })).rejects.toThrow(
      /Transição inválida/
    );

    await surgery.schedule({
      tenantId: tenantA, caseId: created.id, roomId: room2,
      start: "2026-09-03T08:00:00Z", end: "2026-09-03T09:00:00Z",
    });
    await surgery.updateCriticalItems({
      tenantId: tenantA, caseId: created.id,
      opmeStatus: "not_needed", bloodReserve: "not_needed", icuReserve: "not_needed", consentRegistered: true,
    });
    await surgery.confirm({ tenantId: tenantA, caseId: created.id });
    for (const to of ["in_preparation", "in_room", "in_pacu", "completed"] as const) {
      await surgery.transition({ tenantId: tenantA, caseId: created.id, to });
    }
    const journey = await surgery.getJourney(tenantA, created.id);
    expect(journey.case.status).toBe("completed");
    expect(journey.statusEvents).toHaveLength(7);
  });

  test("cancelamento exige causa e LIBERA o horário da sala", async () => {
    const cancelled = await newRequest({ team: [{ name: "Dr. K1", role: "surgeon" }, { name: "Dr. K2", role: "anesthesiologist" }] });
    await surgery.schedule({
      tenantId: tenantA, caseId: cancelled.id, roomId: room1,
      start: "2026-09-04T08:00:00Z", end: "2026-09-04T10:00:00Z",
    });
    await expect(surgery.cancel({ tenantId: tenantA, caseId: cancelled.id, reason: "x" })).rejects.toThrow(
      BadRequestException
    );
    await surgery.cancel({ tenantId: tenantA, caseId: cancelled.id, reason: "Condição clínica do paciente" });

    // O slot liberado aceita outro caso.
    const replacement = await newRequest({ team: [{ name: "Dr. L1", role: "surgeon" }, { name: "Dr. L2", role: "anesthesiologist" }] });
    await surgery.schedule({
      tenantId: tenantA, caseId: replacement.id, roomId: room1,
      start: "2026-09-04T08:00:00Z", end: "2026-09-04T10:00:00Z",
    });

    const journey = await surgery.getJourney(tenantA, cancelled.id);
    expect(journey.case.status).toBe("cancelled");
    expect(journey.case.cancel_reason).toBe("Condição clínica do paciente");

    // Caso encerrado não transiciona mais.
    await expect(surgery.transition({ tenantId: tenantA, caseId: cancelled.id, to: "authorized" })).rejects.toThrow(
      /Transição inválida/
    );
  });
});
