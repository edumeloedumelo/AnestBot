import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PoolClient } from "pg";
import { AuditService } from "../audit/audit.service";
import { DbService } from "../db/db.service";
import { EventsService } from "../events/events.service";

export type CaseStatus =
  | "requested"
  | "authorized"
  | "confirmed"
  | "in_preparation"
  | "in_room"
  | "in_pacu"
  | "completed"
  | "cancelled";

export type TeamRole = "surgeon" | "anesthesiologist" | "assistant" | "nurse" | "instrumentator";
export type Laterality = "left" | "right" | "bilateral" | "not_applicable";

export type TeamMemberInput = { name: string; role: TeamRole; userId?: string | null };

/** Transições válidas da jornada perioperatória (F2-E3). */
const TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  requested: ["authorized", "cancelled"],
  authorized: ["confirmed", "cancelled"],
  confirmed: ["in_preparation", "cancelled"],
  in_preparation: ["in_room", "cancelled"],
  in_room: ["in_pacu", "completed"],
  in_pacu: ["completed"],
  completed: [],
  cancelled: [],
};

const PG_EXCLUSION_VIOLATION = "23P01";

@Injectable()
export class SurgeryService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly events: EventsService
  ) {}

  /**
   * Solicitação cirúrgica (F2-E1). Itens estruturais são obrigatórios já na
   * criação: paciente, ≥1 procedimento VIGENTE, lateralidade, cirurgião e
   * anestesiologista, duração prevista. Os itens críticos de recurso
   * (OPME/sangue/UTI/consentimento) podem nascer indefinidos — mas bloqueiam
   * a confirmação (confirm()).
   */
  async createRequest(input: {
    tenantId: string;
    patientId: string;
    insurerId?: string | null;
    laterality: Laterality;
    procedureCodeIds: string[];
    team: TeamMemberInput[];
    expectedDurationMin: number;
    createdBy?: string | null;
  }): Promise<{ id: string; status: CaseStatus }> {
    if (input.procedureCodeIds.length === 0) {
      throw new BadRequestException("A solicitação exige ao menos um procedimento");
    }
    const roles = new Set(input.team.map((m) => m.role));
    if (!roles.has("surgeon") || !roles.has("anesthesiologist")) {
      throw new BadRequestException("A equipe exige cirurgião e anestesiologista definidos");
    }

    return this.db.withTenant(input.tenantId, async (client) => {
      const patient = await client.query("SELECT active FROM patient WHERE id = $1", [input.patientId]);
      if (!patient.rowCount || !patient.rows[0].active) {
        throw new BadRequestException("Paciente não encontrado ou inativo");
      }
      const inForce = await client.query(
        `SELECT id FROM procedure_code
         WHERE id = ANY($1) AND valid_from <= CURRENT_DATE
           AND (valid_to IS NULL OR valid_to > CURRENT_DATE)`,
        [input.procedureCodeIds]
      );
      if (inForce.rowCount !== input.procedureCodeIds.length) {
        throw new BadRequestException("Todos os procedimentos devem existir e estar vigentes");
      }

      const inserted = await client.query(
        `INSERT INTO surgery_case (tenant_id, patient_id, insurer_id, laterality, expected_duration_min, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, status`,
        [input.tenantId, input.patientId, input.insurerId ?? null, input.laterality, input.expectedDurationMin, input.createdBy ?? null]
      );
      const caseId: string = inserted.rows[0].id;

      for (const [index, procedureCodeId] of input.procedureCodeIds.entries()) {
        await client.query(
          "INSERT INTO case_procedure (tenant_id, case_id, procedure_code_id, is_primary) VALUES ($1, $2, $3, $4)",
          [input.tenantId, caseId, procedureCodeId, index === 0]
        );
      }
      for (const member of input.team) {
        await client.query(
          "INSERT INTO case_team_member (tenant_id, case_id, user_id, name, role) VALUES ($1, $2, $3, $4, $5)",
          [input.tenantId, caseId, member.userId ?? null, member.name.trim(), member.role]
        );
      }
      await this.recordStatus(client, input.tenantId, caseId, null, "requested", input.createdBy ?? null, null);
      await this.audit.append(client, {
        tenantId: input.tenantId,
        actorId: input.createdBy ?? null,
        action: "surgery_case.requested",
        entityType: "surgery_case",
        entityId: caseId,
        data: { patientId: input.patientId, procedures: input.procedureCodeIds, laterality: input.laterality },
      });
      return { id: caseId, status: "requested" };
    });
  }

  /**
   * Agendamento em sala (F2-E2). Conflito de SALA é impossível por constraint
   * no banco; conflito de EQUIPE (cirurgião/anestesiologista em dois lugares)
   * é verificado aqui e rejeitado com o caso conflitante identificado.
   */
  async schedule(input: {
    tenantId: string;
    caseId: string;
    roomId: string;
    start: string; // ISO
    end: string; // ISO
    scheduledBy?: string | null;
  }): Promise<void> {
    if (new Date(input.start) >= new Date(input.end)) {
      throw new BadRequestException("Horário final deve ser posterior ao inicial");
    }
    await this.db.withTenant(input.tenantId, async (client) => {
      const surgeryCase = await this.getCaseForUpdate(client, input.caseId);
      if (["completed", "cancelled", "in_room", "in_pacu"].includes(surgeryCase.status)) {
        throw new BadRequestException(`Caso em status '${surgeryCase.status}' não pode ser reagendado`);
      }
      const room = await client.query("SELECT kind FROM org_unit WHERE id = $1 AND active", [input.roomId]);
      if (!room.rowCount || room.rows[0].kind !== "room") {
        throw new BadRequestException("Sala inválida");
      }

      const teamConflict = await client.query(
        `SELECT DISTINCT sc.id FROM surgery_case sc
         JOIN case_team_member m ON m.case_id = sc.id
         WHERE sc.id <> $1 AND sc.status <> 'cancelled'
           AND sc.scheduled_range && tstzrange($2, $3, '[)')
           AND (m.role, m.name) IN (
             SELECT role, name FROM case_team_member
             WHERE case_id = $1 AND role IN ('surgeon', 'anesthesiologist')
           )`,
        [input.caseId, input.start, input.end]
      );
      if (teamConflict.rowCount) {
        throw new ConflictException({
          message: "Conflito de equipe: cirurgião ou anestesiologista já alocado em outro caso nesse horário",
          conflictingCaseIds: teamConflict.rows.map((r) => r.id),
        });
      }

      try {
        await client.query(
          "UPDATE surgery_case SET room_id = $1, scheduled_range = tstzrange($2, $3, '[)') WHERE id = $4",
          [input.roomId, input.start, input.end, input.caseId]
        );
      } catch (err) {
        if ((err as { code?: string }).code === PG_EXCLUSION_VIOLATION) {
          throw new ConflictException("Sala já ocupada por outro caso nesse horário");
        }
        throw err;
      }
      await this.audit.append(client, {
        tenantId: input.tenantId,
        actorId: input.scheduledBy ?? null,
        action: "surgery_case.scheduled",
        entityType: "surgery_case",
        entityId: input.caseId,
        data: { roomId: input.roomId, start: input.start, end: input.end },
      });
      // Payload mínimo: identificadores e horários, nunca dado clínico.
      await this.events.emit(client, {
        tenantId: input.tenantId,
        topic: "surgery.case_scheduled",
        payload: { caseId: input.caseId, roomId: input.roomId, start: input.start, end: input.end },
      });
    });
  }

  /** Mapa do dia: casos com sala/horário no intervalo do dia informado. */
  async mapForDay(tenantId: string, date: string) {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT sc.id, sc.status, sc.laterality, sc.expected_duration_min,
                sc.opme_status, sc.blood_reserve, sc.icu_reserve, sc.consent_registered,
                lower(sc.scheduled_range) AS start_at, upper(sc.scheduled_range) AS end_at,
                sc.room_id, room.name AS room_name,
                p.full_name AS patient_name, p.mrn AS patient_mrn,
                (SELECT pc.description FROM case_procedure cp
                   JOIN procedure_code pc ON pc.id = cp.procedure_code_id
                 WHERE cp.case_id = sc.id AND cp.is_primary LIMIT 1) AS procedure_name,
                (SELECT m.name FROM case_team_member m WHERE m.case_id = sc.id AND m.role = 'surgeon' LIMIT 1) AS surgeon,
                (SELECT m.name FROM case_team_member m WHERE m.case_id = sc.id AND m.role = 'anesthesiologist' LIMIT 1) AS anesthesiologist
         FROM surgery_case sc
         JOIN org_unit room ON room.id = sc.room_id
         JOIN patient p ON p.id = sc.patient_id
         WHERE sc.status <> 'cancelled'
           AND sc.scheduled_range && tstzrange($1::date, ($1::date + 1), '[)')
         ORDER BY room.name ASC, lower(sc.scheduled_range) ASC`,
        [date]
      );
      return result.rows;
    });
  }

  /** Situação dos itens críticos (OPME, sangue, UTI, consentimento). */
  async updateCriticalItems(input: {
    tenantId: string;
    caseId: string;
    opmeStatus?: "not_needed" | "requested" | "confirmed";
    bloodReserve?: "not_needed" | "reserved";
    icuReserve?: "not_needed" | "reserved";
    consentRegistered?: boolean;
    updatedBy?: string | null;
  }): Promise<void> {
    await this.db.withTenant(input.tenantId, async (client) => {
      await this.getCaseForUpdate(client, input.caseId);
      await client.query(
        `UPDATE surgery_case SET
           opme_status = COALESCE($2, opme_status),
           blood_reserve = COALESCE($3, blood_reserve),
           icu_reserve = COALESCE($4, icu_reserve),
           consent_registered = COALESCE($5, consent_registered)
         WHERE id = $1`,
        [input.caseId, input.opmeStatus ?? null, input.bloodReserve ?? null, input.icuReserve ?? null, input.consentRegistered ?? null]
      );
      await this.audit.append(client, {
        tenantId: input.tenantId,
        actorId: input.updatedBy ?? null,
        action: "surgery_case.critical_items_updated",
        entityType: "surgery_case",
        entityId: input.caseId,
        data: {
          opmeStatus: input.opmeStatus ?? null,
          bloodReserve: input.bloodReserve ?? null,
          icuReserve: input.icuReserve ?? null,
          consentRegistered: input.consentRegistered ?? null,
        },
      });
    });
  }

  /**
   * Confirmação (F2-E1): bloqueada enquanto houver item crítico indefinido —
   * o sistema impede agendamento incompleto de itens críticos por regra,
   * respondendo com a lista exata do que falta.
   */
  async confirm(input: { tenantId: string; caseId: string; confirmedBy?: string | null }): Promise<void> {
    await this.db.withTenant(input.tenantId, async (client) => {
      const surgeryCase = await this.getCaseForUpdate(client, input.caseId);
      if (surgeryCase.status !== "authorized") {
        throw new BadRequestException(`Confirmação exige status 'authorized' (atual: '${surgeryCase.status}')`);
      }
      const missing: string[] = [];
      if (!surgeryCase.scheduled_range) missing.push("Sala e horário agendados");
      if (surgeryCase.opme_status === null) missing.push("Situação de OPME indefinida");
      if (surgeryCase.blood_reserve === null) missing.push("Situação de reserva de sangue indefinida");
      if (surgeryCase.icu_reserve === null) missing.push("Situação de reserva de UTI indefinida");
      if (!surgeryCase.consent_registered) missing.push("Termo de consentimento não registrado");
      if (missing.length > 0) {
        throw new BadRequestException({ message: "Confirmação bloqueada por itens críticos", missing });
      }
      await this.applyTransition(client, input.tenantId, surgeryCase, "confirmed", input.confirmedBy ?? null, null);
    });
  }

  /** Transição de jornada com validação do fluxo permitido. */
  async transition(input: {
    tenantId: string;
    caseId: string;
    to: CaseStatus;
    changedBy?: string | null;
    justification?: string;
  }): Promise<void> {
    if (input.to === "cancelled") {
      throw new BadRequestException("Use cancel() para cancelamentos (causa obrigatória)");
    }
    if (input.to === "confirmed") {
      throw new BadRequestException("Use confirm() para confirmação (valida itens críticos)");
    }
    await this.db.withTenant(input.tenantId, async (client) => {
      const surgeryCase = await this.getCaseForUpdate(client, input.caseId);
      await this.applyTransition(
        client,
        input.tenantId,
        surgeryCase,
        input.to,
        input.changedBy ?? null,
        input.justification ?? null
      );
    });
  }

  /** Cancelamento com causa obrigatória (indicador de cancelamento depende dela). */
  async cancel(input: { tenantId: string; caseId: string; reason: string; cancelledBy?: string | null }): Promise<void> {
    if (input.reason.trim().length < 5) {
      throw new BadRequestException("Causa do cancelamento é obrigatória");
    }
    await this.db.withTenant(input.tenantId, async (client) => {
      const surgeryCase = await this.getCaseForUpdate(client, input.caseId);
      if (!TRANSITIONS[surgeryCase.status as CaseStatus].includes("cancelled")) {
        throw new BadRequestException(`Caso em status '${surgeryCase.status}' não pode ser cancelado`);
      }
      await client.query("UPDATE surgery_case SET cancel_reason = $1 WHERE id = $2", [input.reason.trim(), input.caseId]);
      await this.applyTransition(
        client,
        input.tenantId,
        surgeryCase,
        "cancelled",
        input.cancelledBy ?? null,
        input.reason.trim()
      );
    });
  }

  /** Jornada completa do caso: dados, procedimentos, equipe e linha de status. */
  async getJourney(tenantId: string, caseId: string) {
    return this.db.withTenant(tenantId, async (client) => {
      const surgeryCase = await client.query(
        `SELECT sc.*, p.full_name AS patient_name, p.mrn AS patient_mrn
         FROM surgery_case sc JOIN patient p ON p.id = sc.patient_id
         WHERE sc.id = $1`,
        [caseId]
      );
      if (!surgeryCase.rowCount) {
        throw new NotFoundException("Caso cirúrgico não encontrado");
      }
      const procedures = await client.query(
        `SELECT pc.code_system, pc.code, pc.description, cp.is_primary
         FROM case_procedure cp JOIN procedure_code pc ON pc.id = cp.procedure_code_id
         WHERE cp.case_id = $1 ORDER BY cp.is_primary DESC`,
        [caseId]
      );
      const team = await client.query(
        "SELECT name, role FROM case_team_member WHERE case_id = $1 ORDER BY role",
        [caseId]
      );
      const events = await client.query(
        `SELECT from_status, to_status, justification, occurred_at
         FROM case_status_event WHERE case_id = $1 ORDER BY occurred_at ASC`,
        [caseId]
      );
      return {
        case: surgeryCase.rows[0],
        procedures: procedures.rows,
        team: team.rows,
        statusEvents: events.rows,
      };
    });
  }

  private async getCaseForUpdate(client: PoolClient, caseId: string) {
    const result = await client.query("SELECT * FROM surgery_case WHERE id = $1 FOR UPDATE", [caseId]);
    if (!result.rowCount) {
      throw new NotFoundException("Caso cirúrgico não encontrado");
    }
    return result.rows[0];
  }

  private async applyTransition(
    client: PoolClient,
    tenantId: string,
    surgeryCase: { id: string; status: string },
    to: CaseStatus,
    actorId: string | null,
    justification: string | null
  ): Promise<void> {
    const from = surgeryCase.status as CaseStatus;
    if (!TRANSITIONS[from].includes(to)) {
      throw new BadRequestException(`Transição inválida: '${from}' → '${to}'`);
    }
    await client.query("UPDATE surgery_case SET status = $1 WHERE id = $2", [to, surgeryCase.id]);
    await this.recordStatus(client, tenantId, surgeryCase.id, from, to, actorId, justification);
    await this.audit.append(client, {
      tenantId,
      actorId,
      action: "surgery_case.status_changed",
      entityType: "surgery_case",
      entityId: surgeryCase.id,
      data: { from, to },
      justification,
    });
    await this.events.emit(client, {
      tenantId,
      topic: "surgery.case_status_changed",
      payload: { caseId: surgeryCase.id, from, to },
    });
  }

  private async recordStatus(
    client: PoolClient,
    tenantId: string,
    caseId: string,
    from: string | null,
    to: string,
    changedBy: string | null,
    justification: string | null
  ): Promise<void> {
    await client.query(
      `INSERT INTO case_status_event (tenant_id, case_id, from_status, to_status, changed_by, justification)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, caseId, from, to, changedBy, justification]
    );
  }
}
