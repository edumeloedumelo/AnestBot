/**
 * Testes de integração do outbox de eventos (tempo real do mapa):
 * evento escrito na MESMA transação da escrita de negócio, publicado uma
 * única vez pelo poller, entregue por tenant. Dados 100% sintéticos.
 */
import { Test } from "@nestjs/testing";
import { Client } from "pg";
import { bootstrapTestDatabase } from "./helpers";
import { AuditService } from "../src/audit/audit.service";
import { DbService } from "../src/db/db.service";
import { EventsPublisher, EventsService } from "../src/events/events.service";
import { OrganizationService } from "../src/organization/organization.service";
import { PatientsService } from "../src/patients/patients.service";
import { ProceduresService } from "../src/master-data/procedures.service";
import { SurgeryService } from "../src/surgery/surgery.service";

const TEST_DB = "hospital_os_test_events";

let admin: Client;
let db: DbService;
let surgery: SurgeryService;
let publisher: EventsPublisher;
let tenantA: string;
let caseId: string;

const received: { tenantId: string; topic: string; payload: Record<string, unknown> }[] = [];

beforeAll(async () => {
  const bootstrapped = await bootstrapTestDatabase(TEST_DB);
  admin = bootstrapped.admin;
  tenantA = (
    await admin.query("INSERT INTO tenant (name, slug) VALUES ('Hospital Sintético A', 'hospital-a') RETURNING id")
  ).rows[0].id;

  const moduleRef = await Test.createTestingModule({
    providers: [DbService, AuditService, PatientsService, ProceduresService, OrganizationService, EventsService, EventsPublisher, SurgeryService],
  }).compile();
  db = moduleRef.get(DbService);
  surgery = moduleRef.get(SurgeryService);
  publisher = moduleRef.get(EventsPublisher);
  publisher.register({
    broadcast: (tenantId, topic, payload) => received.push({ tenantId, topic, payload }),
  });

  const patients = moduleRef.get(PatientsService);
  const procedures = moduleRef.get(ProceduresService);
  const organization = moduleRef.get(OrganizationService);

  const patientId = (
    await patients.create({ tenantId: tenantA, fullName: "Paciente Eventos (fictício)", birthDate: "1988-08-08" })
  ).id;
  await procedures.import({
    tenantId: tenantA,
    source: "TUSS sintética",
    rows: [{ codeSystem: "TUSS", code: "30502041", description: "Septoplastia", validFrom: "2020-01-01" }],
  });
  const procedureId = (await procedures.search(tenantA, "30502041"))[0].id;
  const org = await organization.create({ tenantId: tenantA, kind: "organization", name: "Hospital A" });
  const roomId = (await organization.create({ tenantId: tenantA, kind: "room", name: "Sala 1", parentId: org.id })).id;

  caseId = (
    await surgery.createRequest({
      tenantId: tenantA,
      patientId,
      laterality: "not_applicable",
      procedureCodeIds: [procedureId],
      team: [
        { name: "Dr. Teste Sales", role: "surgeon" },
        { name: "Dra. Teste Lopes", role: "anesthesiologist" },
      ],
      expectedDurationMin: 60,
    })
  ).id;
  await surgery.transition({ tenantId: tenantA, caseId, to: "authorized" });
  await surgery.schedule({ tenantId: tenantA, caseId, roomId, start: "2026-09-25T08:00:00Z", end: "2026-09-25T09:00:00Z" });
});

afterAll(async () => {
  publisher?.onModuleDestroy();
  await db?.pool.end();
  await admin?.end();
});

describe("outbox de eventos de domínio", () => {
  test("eventos são gravados na transação de negócio e publicados em ordem, uma única vez", async () => {
    const first = await publisher.poll();
    expect(first).toBeGreaterThanOrEqual(2);
    expect(received.map((e) => e.topic)).toEqual(["surgery.case_status_changed", "surgery.case_scheduled"]);
    expect(received.every((e) => e.tenantId === tenantA)).toBe(true);

    // Segundo poll: nada pendente — publicação é exatamente-uma-vez.
    expect(await publisher.poll()).toBe(0);
  });

  test("payload é mínimo: identificadores e status, sem dado clínico ou nome de paciente", async () => {
    for (const event of received) {
      const serialized = JSON.stringify(event.payload).toLowerCase();
      expect(serialized).not.toContain("fictício".toLowerCase());
      expect(serialized).not.toContain("paciente eventos");
      expect(Object.keys(event.payload).every((k) => ["caseid", "roomid", "start", "end", "from", "to"].includes(k.toLowerCase()))).toBe(true);
    }
  });

  test("mapa do dia retorna o caso agendado com sala, equipe e horários", async () => {
    const map = await surgery.mapForDay(tenantA, "2026-09-25");
    expect(map).toHaveLength(1);
    expect(map[0].room_name).toBe("Sala 1");
    expect(map[0].surgeon).toBe("Dr. Teste Sales");
    expect(map[0].procedure_name).toBe("Septoplastia");
    expect(await surgery.mapForDay(tenantA, "2026-09-26")).toEqual([]);
  });
});
