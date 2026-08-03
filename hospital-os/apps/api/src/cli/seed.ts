/**
 * Seed de demonstração — DADOS 100% SINTÉTICOS.
 * Ferramenta de desenvolvimento: cria o tenant "demo" completo (usuários,
 * estrutura, procedimentos, convênios, pacientes e um dia de mapa cirúrgico)
 * usando os serviços reais do domínio, para que toda regra de negócio e
 * auditoria seja exercitada. NUNCA executar em produção.
 *
 * Uso: JWT_SECRET=x PG*=... npm run seed -w apps/api
 * Requer credencial de banco com permissão de INSERT em tenant (dev/admin).
 */
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { AnesthesiaService } from "../anesthesia/anesthesia.service";
import { DbService } from "../db/db.service";
import { InsurersService } from "../master-data/insurers.service";
import { ProceduresService } from "../master-data/procedures.service";
import { OrganizationService } from "../organization/organization.service";
import { PatientsService } from "../patients/patients.service";
import { allYes, ChecklistService } from "../surgery/checklist.service";
import { SurgeryService } from "../surgery/surgery.service";
import { UsersService } from "../identity/users.service";

function todayAt(hour: number, minute = 0): string {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  const db = app.get(DbService);

  const existing = await db.pool.query("SELECT id FROM tenant WHERE slug = 'demo'");
  if (existing.rowCount) {
    console.info("Tenant 'demo' já existe — seed é idempotente por desistência. Nada a fazer.");
    await app.close();
    return;
  }

  const tenantId: string = (
    await db.pool.query("INSERT INTO tenant (name, slug) VALUES ('Hospital Demo (sintético)', 'demo') RETURNING id")
  ).rows[0].id;

  const users = app.get(UsersService);
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "Demo123!Trocar";
  const admin = await users.createUser({
    tenantId,
    email: "admin@demo.hospital-os.test",
    fullName: "Administrador Demo",
    password: adminPassword,
  });
  await users.assignRole({ tenantId, userId: admin.id, role: "admin" });
  const anest = await users.createUser({
    tenantId,
    email: "anestesista@demo.hospital-os.test",
    fullName: "Dr. Teste Melo",
    password: adminPassword,
  });
  await users.assignRole({ tenantId, userId: anest.id, role: "anesthesiologist" });

  const organization = app.get(OrganizationService);
  const org = await organization.create({ tenantId, kind: "organization", name: "Hospital Demo" });
  const cc = await organization.create({ tenantId, kind: "unit", name: "Centro Cirúrgico", parentId: org.id });
  const rooms: string[] = [];
  for (const name of ["Sala 1", "Sala 2", "Sala 3", "Sala 4"]) {
    rooms.push((await organization.create({ tenantId, kind: "room", name, parentId: cc.id })).id);
  }

  const procedures = app.get(ProceduresService);
  await procedures.import({
    tenantId,
    source: "TUSS sintética (seed)",
    rows: [
      { codeSystem: "TUSS", code: "31005497", description: "Colecistectomia videolaparoscópica", validFrom: "2020-01-01" },
      { codeSystem: "TUSS", code: "30731063", description: "Artroscopia de joelho", validFrom: "2020-01-01" },
      { codeSystem: "TUSS", code: "30602084", description: "Mamoplastia redutora", validFrom: "2020-01-01" },
      { codeSystem: "TUSS", code: "31201075", description: "RTU de próstata", validFrom: "2020-01-01" },
      { codeSystem: "TUSS", code: "30403044", description: "Tireoidectomia total", validFrom: "2020-01-01" },
      { codeSystem: "TUSS", code: "31003079", description: "Herniorrafia inguinal", validFrom: "2020-01-01" },
      { codeSystem: "TUSS", code: "30502041", description: "Septoplastia", validFrom: "2020-01-01" },
      { codeSystem: "TUSS", code: "30306027", description: "Facectomia com LIO", validFrom: "2020-01-01" },
    ],
  });
  const proc = async (code: string) => (await procedures.search(tenantId, code))[0].id;

  const insurers = app.get(InsurersService);
  const unimed = await insurers.create({ tenantId, name: "Convênio Sintético A", ansCode: "123456" });
  await insurers.create({ tenantId, name: "Convênio Sintético B" });

  const patients = app.get(PatientsService);
  const patientIds: string[] = [];
  const synthetic: [string, string, "F" | "M"][] = [
    ["Maria Aparecida Souza (fictício)", "1958-03-12", "F"],
    ["João Carlos Ferreira (fictício)", "1979-07-04", "M"],
    ["Ana Beatriz Lima (fictício)", "1991-11-22", "F"],
    ["Carlos Eduardo Ramos (fictício)", "1950-01-30", "M"],
    ["Fernanda Oliveira Castro (fictício)", "1985-09-15", "F"],
    ["Roberto Nogueira Braga (fictício)", "1969-05-09", "M"],
  ];
  for (const [fullName, birthDate, sex] of synthetic) {
    patientIds.push((await patients.create({ tenantId, fullName, birthDate, sex })).id);
  }

  const surgery = app.get(SurgeryService);
  const checklist = app.get(ChecklistService);
  const anesthesia = app.get(AnesthesiaService);

  // Um anestesiologista por sala concorrente — o próprio sistema rejeita
  // equipe alocada em dois lugares no mesmo horário.
  const mkCase = async (opts: {
    patient: number;
    code: string;
    surgeon: string;
    anesthesiologist?: string;
    room: number;
    from: [number, number];
    durationMin: number;
  }) => {
    const anesthName = opts.anesthesiologist ?? "Dr. Teste Melo";
    const created = await surgery.createRequest({
      tenantId,
      patientId: patientIds[opts.patient],
      insurerId: unimed.id,
      laterality: "not_applicable",
      procedureCodeIds: [await proc(opts.code)],
      team: [
        { name: opts.surgeon, role: "surgeon" },
        { name: anesthName, role: "anesthesiologist", userId: anesthName === "Dr. Teste Melo" ? anest.id : null },
      ],
      expectedDurationMin: opts.durationMin,
      createdBy: admin.id,
    });
    await surgery.transition({ tenantId, caseId: created.id, to: "authorized", changedBy: admin.id });
    const start = todayAt(opts.from[0], opts.from[1]);
    const end = new Date(new Date(start).getTime() + opts.durationMin * 60_000).toISOString();
    await surgery.schedule({ tenantId, caseId: created.id, roomId: rooms[opts.room], start, end, scheduledBy: admin.id });
    return created.id;
  };

  // Caso concluído (jornada completa com checklist, ficha e RPA).
  const done = await mkCase({ patient: 0, code: "31005497", surgeon: "Dr. Teste Andrade", room: 0, from: [7, 30], durationMin: 120 });
  await surgery.updateCriticalItems({ tenantId, caseId: done, opmeStatus: "not_needed", bloodReserve: "not_needed", icuReserve: "not_needed", consentRegistered: true, updatedBy: admin.id });
  await surgery.confirm({ tenantId, caseId: done, confirmedBy: admin.id });
  await surgery.transition({ tenantId, caseId: done, to: "in_preparation", changedBy: admin.id });
  await surgery.transition({ tenantId, caseId: done, to: "in_room", changedBy: admin.id });
  await anesthesia.createAssessment({ tenantId, caseId: done, asa: "II", payload: { comorbidades: ["HAS"], viaAerea: { mallampati: "II" } }, decision: "cleared", signedBy: anest.id });
  const record = await anesthesia.openRecord({ tenantId, caseId: done, technique: "Geral balanceada", openedBy: anest.id });
  await anesthesia.addEvent({ tenantId, recordId: record.id, eventType: "drug", payload: { drug: "Propofol", dose: "150 mg", route: "EV" }, recordedBy: anest.id });
  await anesthesia.addEvent({ tenantId, recordId: record.id, eventType: "milestone", payload: { milestone: "Incisão" }, recordedBy: anest.id });
  for (const phase of ["sign_in", "time_out", "sign_out"] as const) {
    await checklist.executePhase({ tenantId, caseId: done, phase, answers: allYes(phase), executedBy: anest.id });
  }
  await anesthesia.closeRecord({ tenantId, recordId: record.id, closedBy: anest.id });
  await surgery.transition({ tenantId, caseId: done, to: "in_pacu", changedBy: anest.id });
  const stay = await anesthesia.admitToPacu({ tenantId, caseId: done, admittedBy: anest.id });
  await anesthesia.observe({ tenantId, stayId: stay.id, aldrete: 10, pain: 1, vitals: { pa: "122x78", fc: 74, spo2: "98%" }, observedBy: anest.id });
  await anesthesia.discharge({ tenantId, stayId: stay.id, dischargedBy: anest.id });
  await surgery.transition({ tenantId, caseId: done, to: "completed", changedBy: anest.id });

  // Caso em sala agora.
  const inRoom = await mkCase({ patient: 2, code: "30602084", surgeon: "Dr. Teste Prado", anesthesiologist: "Dra. Teste Rocha", room: 1, from: [8, 0], durationMin: 180 });
  await surgery.updateCriticalItems({ tenantId, caseId: inRoom, opmeStatus: "confirmed", bloodReserve: "not_needed", icuReserve: "not_needed", consentRegistered: true, updatedBy: admin.id });
  await surgery.confirm({ tenantId, caseId: inRoom, confirmedBy: admin.id });
  await surgery.transition({ tenantId, caseId: inRoom, to: "in_preparation", changedBy: admin.id });
  await surgery.transition({ tenantId, caseId: inRoom, to: "in_room", changedBy: admin.id });

  // Confirmado para a tarde; autorizado com pendências; solicitado.
  const confirmed = await mkCase({ patient: 1, code: "30731063", surgeon: "Dra. Teste Nunes", room: 2, from: [14, 0], durationMin: 90 });
  await surgery.updateCriticalItems({ tenantId, caseId: confirmed, opmeStatus: "confirmed", bloodReserve: "not_needed", icuReserve: "not_needed", consentRegistered: true, updatedBy: admin.id });
  await surgery.confirm({ tenantId, caseId: confirmed, confirmedBy: admin.id });
  await mkCase({ patient: 3, code: "31201075", surgeon: "Dr. Teste Cunha", anesthesiologist: "Dra. Teste Lopes", room: 1, from: [13, 0], durationMin: 90 });
  await mkCase({ patient: 4, code: "30403044", surgeon: "Dra. Teste Braga", anesthesiologist: "Dr. Teste Viana", room: 3, from: [9, 0], durationMin: 150 });

  // Cancelado com causa.
  const cancelled = await mkCase({ patient: 5, code: "31003079", surgeon: "Dr. Teste Andrade", room: 2, from: [16, 0], durationMin: 75 });
  await surgery.cancel({ tenantId, caseId: cancelled, reason: "Autorização não liberada", cancelledBy: admin.id });

  console.info("Seed concluído — tenant 'demo' criado com dados 100% sintéticos.");
  console.info("Login: slug 'demo' · admin@demo.hospital-os.test ou anestesista@demo.hospital-os.test");
  console.info(
    process.env.SEED_ADMIN_PASSWORD
      ? "Senha: definida via SEED_ADMIN_PASSWORD."
      : "Senha padrão de desenvolvimento: 'Demo123!Trocar' — defina SEED_ADMIN_PASSWORD para outra."
  );
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
