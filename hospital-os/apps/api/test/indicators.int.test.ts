/**
 * Testes de integração dos indicadores do centro cirúrgico (F2-E8):
 * um caso completo (com checklist e RPA) + um cancelado alimentam o relatório;
 * todo indicador carrega dicionário completo. Dados 100% sintéticos.
 */
import { Test } from "@nestjs/testing";
import { Client } from "pg";
import { bootstrapTestDatabase } from "./helpers";
import { AnesthesiaService } from "../src/anesthesia/anesthesia.service";
import { AuditService } from "../src/audit/audit.service";
import { DbService } from "../src/db/db.service";
import { IndicatorsService } from "../src/analytics/indicators.service";
import { OrganizationService } from "../src/organization/organization.service";
import { PatientsService } from "../src/patients/patients.service";
import { ProceduresService } from "../src/master-data/procedures.service";
import { allYes, ChecklistService } from "../src/surgery/checklist.service";
import { SurgeryService } from "../src/surgery/surgery.service";

const TEST_DB = "hospital_os_test_indicators";

let admin: Client;
let db: DbService;
let indicators: IndicatorsService;
let tenantA: string;

beforeAll(async () => {
  const bootstrapped = await bootstrapTestDatabase(TEST_DB);
  admin = bootstrapped.admin;
  tenantA = (
    await admin.query("INSERT INTO tenant (name, slug) VALUES ('Hospital Sintético A', 'hospital-a') RETURNING id")
  ).rows[0].id;

  const moduleRef = await Test.createTestingModule({
    providers: [
      DbService, AuditService, PatientsService, ProceduresService, OrganizationService,
      SurgeryService, ChecklistService, AnesthesiaService, IndicatorsService,
    ],
  }).compile();
  db = moduleRef.get(DbService);
  indicators = moduleRef.get(IndicatorsService);
  const surgery = moduleRef.get(SurgeryService);
  const checklist = moduleRef.get(ChecklistService);
  const anesthesia = moduleRef.get(AnesthesiaService);

  const patients = moduleRef.get(PatientsService);
  const procedures = moduleRef.get(ProceduresService);
  const organization = moduleRef.get(OrganizationService);

  const patientId = (
    await patients.create({ tenantId: tenantA, fullName: "Paciente Indicadores (fictício)", birthDate: "1985-02-20" })
  ).id;
  await procedures.import({
    tenantId: tenantA,
    source: "TUSS sintética",
    rows: [{ codeSystem: "TUSS", code: "31003079", description: "Herniorrafia inguinal", validFrom: "2020-01-01" }],
  });
  const procedureId = (await procedures.search(tenantA, "31003079"))[0].id;
  const org = await organization.create({ tenantId: tenantA, kind: "organization", name: "Hospital A" });
  const roomId = (await organization.create({ tenantId: tenantA, kind: "room", name: "Sala 1", parentId: org.id })).id;

  const team = [
    { name: "Dr. Teste Andrade", role: "surgeon" as const },
    { name: "Dr. Teste Melo", role: "anesthesiologist" as const },
  ];

  // Caso 1: jornada completa com checklist e RPA.
  const done = await surgery.createRequest({
    tenantId: tenantA, patientId, laterality: "left",
    procedureCodeIds: [procedureId], team, expectedDurationMin: 75,
  });
  await surgery.transition({ tenantId: tenantA, caseId: done.id, to: "authorized" });
  await surgery.schedule({
    tenantId: tenantA, caseId: done.id, roomId, start: "2026-09-20T08:00:00Z", end: "2026-09-20T09:15:00Z",
  });
  await surgery.updateCriticalItems({
    tenantId: tenantA, caseId: done.id,
    opmeStatus: "confirmed", bloodReserve: "not_needed", icuReserve: "not_needed", consentRegistered: true,
  });
  await surgery.confirm({ tenantId: tenantA, caseId: done.id });
  await surgery.transition({ tenantId: tenantA, caseId: done.id, to: "in_preparation" });
  await surgery.transition({ tenantId: tenantA, caseId: done.id, to: "in_room" });
  for (const phase of ["sign_in", "time_out", "sign_out"] as const) {
    await checklist.executePhase({ tenantId: tenantA, caseId: done.id, phase, answers: allYes(phase) });
  }
  await surgery.transition({ tenantId: tenantA, caseId: done.id, to: "in_pacu" });
  const stay = await anesthesia.admitToPacu({ tenantId: tenantA, caseId: done.id });
  await anesthesia.observe({
    tenantId: tenantA, stayId: stay.id, aldrete: 10, pain: 1, vitals: { pa: "120x80", fc: 72, spo2: "99%" },
  });
  await anesthesia.discharge({ tenantId: tenantA, stayId: stay.id });
  await surgery.transition({ tenantId: tenantA, caseId: done.id, to: "completed" });

  // Caso 2: cancelado com causa.
  const cancelled = await surgery.createRequest({
    tenantId: tenantA, patientId, laterality: "right",
    procedureCodeIds: [procedureId],
    team: [{ name: "Dra. Outra", role: "surgeon" }, { name: "Dr. Outro", role: "anesthesiologist" }],
    expectedDurationMin: 60,
  });
  await surgery.cancel({ tenantId: tenantA, caseId: cancelled.id, reason: "Autorização não liberada" });
});

afterAll(async () => {
  await db?.pool.end();
  await admin?.end();
});

describe("relatório do centro cirúrgico", () => {
  test("calcula volume, cancelamento por causa, adesão e tempo de RPA", async () => {
    const now = new Date();
    const from = new Date(now.getTime() - 24 * 3600_000).toISOString();
    const to = new Date(now.getTime() + 24 * 3600_000).toISOString();
    const report = await indicators.surgicalCenterReport(tenantA, from, to);
    const byId = Object.fromEntries(report.map((i) => [i.id, i]));

    expect(byId.surgeries_completed.value).toBe(1);
    expect(byId.cancellations_by_cause.value).toEqual([{ cause: "Autorização não liberada", count: 1 }]);
    expect(byId.checklist_adherence.value).toBe(100);
    expect(byId.avg_pacu_minutes.value).toBeGreaterThanOrEqual(0);
  });

  test("todo indicador publicado carrega dicionário completo", async () => {
    const report = await indicators.surgicalCenterReport(tenantA, "2026-01-01", "2027-01-01");
    for (const indicator of report) {
      expect(indicator.dictionary.definition).toBeTruthy();
      expect(indicator.dictionary.formula).toBeTruthy();
      expect(indicator.dictionary.source).toBeTruthy();
      expect(indicator.dictionary.period).toBeTruthy();
      expect(indicator.dictionary.limitations).toBeTruthy();
    }
  });
});
