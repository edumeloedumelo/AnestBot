/**
 * Testes de integração do módulo de anestesia (F2-E5/E6/E7):
 * avaliação versionada (supersede), ficha com eventos retroativos marcados,
 * anulação sem apagar (aplicação e privilégio do banco), RPA com alta por
 * critérios ou justificativa. Dados 100% sintéticos.
 */
import { Test } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { Client } from "pg";
import { bootstrapTestDatabase } from "./helpers";
import { AnesthesiaService } from "../src/anesthesia/anesthesia.service";
import { AuditService } from "../src/audit/audit.service";
import { DbService } from "../src/db/db.service";
import { OrganizationService } from "../src/organization/organization.service";
import { PatientsService } from "../src/patients/patients.service";
import { ProceduresService } from "../src/master-data/procedures.service";
import { SurgeryService } from "../src/surgery/surgery.service";

const TEST_DB = "hospital_os_test_anesthesia";

let admin: Client;
let db: DbService;
let surgery: SurgeryService;
let anesthesia: AnesthesiaService;
let tenantA: string;
let caseId: string;
let recordId: string;
let stayId: string;

beforeAll(async () => {
  const bootstrapped = await bootstrapTestDatabase(TEST_DB);
  admin = bootstrapped.admin;
  tenantA = (
    await admin.query("INSERT INTO tenant (name, slug) VALUES ('Hospital Sintético A', 'hospital-a') RETURNING id")
  ).rows[0].id;

  const moduleRef = await Test.createTestingModule({
    providers: [DbService, AuditService, PatientsService, ProceduresService, OrganizationService, SurgeryService, AnesthesiaService],
  }).compile();
  db = moduleRef.get(DbService);
  surgery = moduleRef.get(SurgeryService);
  anesthesia = moduleRef.get(AnesthesiaService);

  const patients = moduleRef.get(PatientsService);
  const procedures = moduleRef.get(ProceduresService);
  const organization = moduleRef.get(OrganizationService);

  const patientId = (
    await patients.create({ tenantId: tenantA, fullName: "Paciente Anestesia (fictício)", birthDate: "1975-06-15" })
  ).id;
  await procedures.import({
    tenantId: tenantA,
    source: "TUSS sintética",
    rows: [{ codeSystem: "TUSS", code: "30602084", description: "Mamoplastia", validFrom: "2020-01-01" }],
  });
  const procedureId = (await procedures.search(tenantA, "30602084"))[0].id;
  const org = await organization.create({ tenantId: tenantA, kind: "organization", name: "Hospital A" });
  const roomId = (await organization.create({ tenantId: tenantA, kind: "room", name: "Sala 2", parentId: org.id })).id;

  caseId = (
    await surgery.createRequest({
      tenantId: tenantA,
      patientId,
      laterality: "bilateral",
      procedureCodeIds: [procedureId],
      team: [
        { name: "Dr. Teste Prado", role: "surgeon" },
        { name: "Dra. Teste Rocha", role: "anesthesiologist" },
      ],
      expectedDurationMin: 180,
    })
  ).id;
  await surgery.transition({ tenantId: tenantA, caseId, to: "authorized" });
  await surgery.schedule({ tenantId: tenantA, caseId, roomId, start: "2026-09-15T08:00:00Z", end: "2026-09-15T11:00:00Z" });
  await surgery.updateCriticalItems({
    tenantId: tenantA, caseId,
    opmeStatus: "not_needed", bloodReserve: "not_needed", icuReserve: "not_needed", consentRegistered: true,
  });
  await surgery.confirm({ tenantId: tenantA, caseId });
});

afterAll(async () => {
  await db?.pool.end();
  await admin?.end();
});

describe("avaliação pré-anestésica versionada", () => {
  test("adiamento sem motivo é rejeitado", async () => {
    await expect(
      anesthesia.createAssessment({
        tenantId: tenantA, caseId, asa: "II", payload: { comorbidades: ["HAS"] }, decision: "postponed",
      })
    ).rejects.toThrow(BadRequestException);
  });

  test("nova versão supersede a anterior sem apagar", async () => {
    const v1 = await anesthesia.createAssessment({
      tenantId: tenantA, caseId, asa: "II",
      payload: { comorbidades: ["HAS"], viaAerea: { mallampati: "II" } },
      decision: "cleared_with_pending",
    });
    expect(v1.version).toBe(1);

    const v2 = await anesthesia.createAssessment({
      tenantId: tenantA, caseId, asa: "II",
      payload: { comorbidades: ["HAS", "DM2"], viaAerea: { mallampati: "II" } },
      decision: "cleared",
    });
    expect(v2.version).toBe(2);

    const current = await anesthesia.currentAssessment(tenantA, caseId);
    expect(current.version).toBe(2);
    const all = await db.withTenant(tenantA, (client) =>
      client.query("SELECT version, superseded_by FROM pre_anesthetic_assessment WHERE case_id = $1 ORDER BY version", [caseId])
    );
    expect(all.rowCount).toBe(2);
    expect(all.rows[0].superseded_by).not.toBeNull();
  });
});

describe("ficha anestésica", () => {
  test("exige caso em sala; abre uma única ficha", async () => {
    await expect(
      anesthesia.openRecord({ tenantId: tenantA, caseId, technique: "Geral balanceada" })
    ).rejects.toThrow(/exige caso em sala/);

    await surgery.transition({ tenantId: tenantA, caseId, to: "in_preparation" });
    await surgery.transition({ tenantId: tenantA, caseId, to: "in_room" });
    recordId = (await anesthesia.openRecord({ tenantId: tenantA, caseId, technique: "Geral balanceada" })).id;

    await expect(
      anesthesia.openRecord({ tenantId: tenantA, caseId, technique: "Outra" })
    ).rejects.toThrow(/Já existe ficha/);
  });

  test("evento imediato não é retroativo; evento com horário antigo é marcado", async () => {
    const now = await anesthesia.addEvent({
      tenantId: tenantA, recordId, eventType: "drug",
      payload: { drug: "Propofol", dose: "150 mg", route: "EV" },
    });
    expect(now.retroactive).toBe(false);

    const past = new Date(Date.now() - 10 * 60_000).toISOString();
    const retro = await anesthesia.addEvent({
      tenantId: tenantA, recordId, eventType: "milestone",
      payload: { milestone: "Intubação orotraqueal" }, occurredAt: past,
    });
    expect(retro.retroactive).toBe(true);
  });

  test("anulação preserva o original; UPDATE direto em evento é negado por privilégio", async () => {
    const wrong = await anesthesia.addEvent({
      tenantId: tenantA, recordId, eventType: "drug",
      payload: { drug: "Fentanil", dose: "500 mcg", route: "EV" },
    });
    await expect(
      anesthesia.annulEvent({ tenantId: tenantA, recordId, eventId: wrong.id, justification: "x" })
    ).rejects.toThrow(/justificativa/);
    await anesthesia.annulEvent({
      tenantId: tenantA, recordId, eventId: wrong.id, justification: "Dose registrada errada; correto 50 mcg.",
    });
    await anesthesia.addEvent({
      tenantId: tenantA, recordId, eventType: "drug",
      payload: { drug: "Fentanil", dose: "50 mcg", route: "EV" },
    });

    const timeline = await anesthesia.timeline(tenantA, recordId);
    const annulled = timeline.find((e: { id: string }) => e.id === wrong.id);
    expect(annulled.annulled).toBe(true);
    expect(annulled.payload.dose).toBe("500 mcg"); // original preservado

    await expect(
      db.withTenant(tenantA, (client) =>
        client.query("UPDATE anesthetic_event SET payload = '{}'::jsonb WHERE id = $1", [wrong.id])
      )
    ).rejects.toThrow(/permission denied/);
  });

  test("ficha encerrada não aceita novos eventos", async () => {
    await anesthesia.closeRecord({ tenantId: tenantA, recordId });
    await expect(
      anesthesia.addEvent({ tenantId: tenantA, recordId, eventType: "annotation", payload: { note: "tarde demais" } })
    ).rejects.toThrow(/encerrada/);
  });
});

describe("recuperação pós-anestésica", () => {
  test("admissão exige status in_pacu; alta exige observação", async () => {
    await surgery.transition({ tenantId: tenantA, caseId, to: "in_pacu" });
    stayId = (await anesthesia.admitToPacu({ tenantId: tenantA, caseId })).id;
    await expect(anesthesia.discharge({ tenantId: tenantA, stayId })).rejects.toThrow(/ao menos uma observação/);
  });

  test("critérios não atingidos exigem justificativa; atingidos liberam alta", async () => {
    await anesthesia.observe({
      tenantId: tenantA, stayId, aldrete: 7, pain: 6, vitals: { pa: "150x95", fc: 110, spo2: "93%" },
    });
    const blocked = await anesthesia
      .discharge({ tenantId: tenantA, stayId })
      .then(() => null)
      .catch((err: BadRequestException) => err.getResponse() as { message: string });
    expect(blocked?.message).toContain("Critérios de alta não atingidos");

    await anesthesia.observe({
      tenantId: tenantA, stayId, aldrete: 10, pain: 2, vitals: { pa: "128x80", fc: 76, spo2: "98%" },
    });
    const result = await anesthesia.discharge({ tenantId: tenantA, stayId });
    expect(result.criteriaMet).toBe(true);

    await surgery.transition({ tenantId: tenantA, caseId, to: "completed" });
    const audited = await db.withTenant(tenantA, (client) =>
      client.query("SELECT action FROM audit_event WHERE action = 'pacu.discharged'")
    );
    expect(audited.rowCount).toBe(1);
  });
});
