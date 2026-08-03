/**
 * Testes de integração do checklist de cirurgia segura (F2-E4):
 * ordem das fases, completude obrigatória, justificativa em não conformidade
 * (aplicação E banco), execução única por fase, auditoria. Dados sintéticos.
 */
import { Test } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { Client } from "pg";
import { bootstrapTestDatabase } from "./helpers";
import { AuditService } from "../src/audit/audit.service";
import { DbService } from "../src/db/db.service";
import { OrganizationService } from "../src/organization/organization.service";
import { PatientsService } from "../src/patients/patients.service";
import { ProceduresService } from "../src/master-data/procedures.service";
import { allYes, ChecklistService, CHECKLIST_ITEMS } from "../src/surgery/checklist.service";
import { SurgeryService } from "../src/surgery/surgery.service";

const TEST_DB = "hospital_os_test_checklist";

let admin: Client;
let db: DbService;
let surgery: SurgeryService;
let checklist: ChecklistService;
let tenantA: string;
let caseId: string;

beforeAll(async () => {
  const bootstrapped = await bootstrapTestDatabase(TEST_DB);
  admin = bootstrapped.admin;
  tenantA = (
    await admin.query("INSERT INTO tenant (name, slug) VALUES ('Hospital Sintético A', 'hospital-a') RETURNING id")
  ).rows[0].id;

  const moduleRef = await Test.createTestingModule({
    providers: [DbService, AuditService, PatientsService, ProceduresService, OrganizationService, SurgeryService, ChecklistService],
  }).compile();
  db = moduleRef.get(DbService);
  surgery = moduleRef.get(SurgeryService);
  checklist = moduleRef.get(ChecklistService);

  const patients = moduleRef.get(PatientsService);
  const procedures = moduleRef.get(ProceduresService);
  const organization = moduleRef.get(OrganizationService);

  const patientId = (
    await patients.create({ tenantId: tenantA, fullName: "Paciente Checklist (fictício)", birthDate: "1980-01-01" })
  ).id;
  await procedures.import({
    tenantId: tenantA,
    source: "TUSS sintética",
    rows: [{ codeSystem: "TUSS", code: "30731063", description: "Artroscopia de joelho", validFrom: "2020-01-01" }],
  });
  const procedureId = (await procedures.search(tenantA, "30731063"))[0].id;
  const org = await organization.create({ tenantId: tenantA, kind: "organization", name: "Hospital A" });
  const roomId = (await organization.create({ tenantId: tenantA, kind: "room", name: "Sala 1", parentId: org.id })).id;

  const created = await surgery.createRequest({
    tenantId: tenantA,
    patientId,
    laterality: "right",
    procedureCodeIds: [procedureId],
    team: [
      { name: "Dra. Teste Nunes", role: "surgeon" },
      { name: "Dr. Teste Melo", role: "anesthesiologist" },
    ],
    expectedDurationMin: 90,
  });
  caseId = created.id;
  await surgery.transition({ tenantId: tenantA, caseId, to: "authorized" });
  await surgery.schedule({ tenantId: tenantA, caseId, roomId, start: "2026-09-10T08:00:00Z", end: "2026-09-10T09:30:00Z" });
  await surgery.updateCriticalItems({
    tenantId: tenantA, caseId,
    opmeStatus: "confirmed", bloodReserve: "not_needed", icuReserve: "not_needed", consentRegistered: true,
  });
  await surgery.confirm({ tenantId: tenantA, caseId });
  await surgery.transition({ tenantId: tenantA, caseId, to: "in_preparation" });
});

afterAll(async () => {
  await db?.pool.end();
  await admin?.end();
});

describe("checklist de cirurgia segura", () => {
  test("time_out antes de sign_in é rejeitado (ordem obrigatória)", async () => {
    await surgery.transition({ tenantId: tenantA, caseId, to: "in_room" });
    await expect(
      checklist.executePhase({ tenantId: tenantA, caseId, phase: "time_out", answers: allYes("time_out") })
    ).rejects.toThrow(/fases anteriores/);
  });

  test("checklist incompleto lista os itens faltantes", async () => {
    const partial = allYes("sign_in").slice(0, 3);
    const error = await checklist
      .executePhase({ tenantId: tenantA, caseId, phase: "sign_in", answers: partial })
      .then(() => null)
      .catch((err: BadRequestException) => err.getResponse() as { missing: string[] });
    expect(error?.missing).toHaveLength(CHECKLIST_ITEMS.sign_in.length - 3);
  });

  test("não conformidade sem justificativa é rejeitada; com justificativa registra", async () => {
    const answers = allYes("sign_in").map((a) =>
      a.item === "Sítio cirúrgico demarcado" ? { ...a, answer: "no" as const } : a
    );
    await expect(checklist.executePhase({ tenantId: tenantA, caseId, phase: "sign_in", answers })).rejects.toThrow(
      /exige justificativa/
    );

    const justified = answers.map((a) =>
      a.answer === "no" ? { ...a, justification: "Demarcação dispensada: procedimento em linha média." } : a
    );
    const result = await checklist.executePhase({ tenantId: tenantA, caseId, phase: "sign_in", answers: justified });
    expect(result.nonConformities).toBe(1);
  });

  test("a constraint do banco também bloqueia 'no' sem justificativa", async () => {
    const execution = await db.withTenant(tenantA, (client) =>
      client.query("SELECT id FROM checklist_execution WHERE case_id = $1 LIMIT 1", [caseId])
    );
    await expect(
      db.withTenant(tenantA, (client) =>
        client.query(
          "INSERT INTO checklist_answer (tenant_id, execution_id, item, answer) VALUES ($1, $2, 'Item forjado', 'no')",
          [tenantA, execution.rows[0].id]
        )
      )
    ).rejects.toThrow(/checklist_answer/);
  });

  test("fase repetida é rejeitada; fluxo completo fecha as 3 fases", async () => {
    await expect(
      checklist.executePhase({ tenantId: tenantA, caseId, phase: "sign_in", answers: allYes("sign_in") })
    ).rejects.toThrow(/já executada/);

    await checklist.executePhase({ tenantId: tenantA, caseId, phase: "time_out", answers: allYes("time_out") });
    await checklist.executePhase({ tenantId: tenantA, caseId, phase: "sign_out", answers: allYes("sign_out") });

    const adherence = await checklist.adherence(tenantA, caseId);
    expect(adherence.completed).toEqual(["sign_in", "time_out", "sign_out"]);
    expect(adherence.pending).toEqual([]);

    const audited = await db.withTenant(tenantA, (client) =>
      client.query("SELECT action FROM audit_event WHERE action LIKE 'checklist.%' ORDER BY seq")
    );
    expect(audited.rows.map((r) => r.action)).toEqual([
      "checklist.sign_in_completed",
      "checklist.time_out_completed",
      "checklist.sign_out_completed",
    ]);
  });
});
