import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PoolClient } from "pg";
import { AuditService } from "../audit/audit.service";
import { DbService } from "../db/db.service";

export type Asa = "I" | "II" | "III" | "IV" | "V";
export type AssessmentDecision = "cleared" | "cleared_with_pending" | "postponed";
export type AnestheticEventType =
  | "drug"
  | "fluid"
  | "blood_product"
  | "milestone"
  | "clinical"
  | "vital_sign"
  | "annotation";

/** Registro considerado retroativo quando o momento clínico difere do momento do registro além desta tolerância. */
const RETROACTIVE_TOLERANCE_MS = 60_000;

/**
 * A ficha costuma ser aberta DEPOIS de eventos já ocorridos (indução antes do
 * registro). Eventos podem ser lançados até esta janela antes da abertura —
 * sempre marcados como retroativos.
 */
const PRE_START_WINDOW_MS = 60 * 60_000;

/** Critérios de alta da RPA (parametrização por instituição na implantação). */
const DISCHARGE_CRITERIA = { minAldrete: 9, maxPain: 3 };

@Injectable()
export class AnesthesiaService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService
  ) {}

  // ---------- Avaliação pré-anestésica (F2-E5) ----------

  /**
   * Nova avaliação SUPERSEDE a anterior (versão+1); nenhuma versão é apagada.
   * Adiamento exige motivo. A triagem assistida por IA (herdada do AnestBot)
   * alimenta `payload.examReview` já com as decisões humanas — nada entra sem
   * aceite explícito (ADR-007); este serviço não persiste sugestão pendente.
   */
  async createAssessment(input: {
    tenantId: string;
    caseId: string;
    asa: Asa;
    payload: Record<string, unknown>;
    decision: AssessmentDecision;
    decisionReason?: string;
    signedBy?: string | null;
  }): Promise<{ id: string; version: number }> {
    if (input.decision === "postponed" && !input.decisionReason?.trim()) {
      throw new BadRequestException("Adiamento/contraindicação exige motivo registrado");
    }
    return this.db.withTenant(input.tenantId, async (client) => {
      await this.requireCase(client, input.caseId);
      const previous = await client.query(
        "SELECT id, version FROM pre_anesthetic_assessment WHERE case_id = $1 AND superseded_by IS NULL FOR UPDATE",
        [input.caseId]
      );
      const version = previous.rowCount ? previous.rows[0].version + 1 : 1;
      const inserted = await client.query(
        `INSERT INTO pre_anesthetic_assessment (tenant_id, case_id, version, asa, payload, decision, decision_reason, signed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          input.tenantId,
          input.caseId,
          version,
          input.asa,
          input.payload,
          input.decision,
          input.decisionReason?.trim() ?? null,
          input.signedBy ?? null,
        ]
      );
      const id: string = inserted.rows[0].id;
      if (previous.rowCount) {
        await client.query("UPDATE pre_anesthetic_assessment SET superseded_by = $1 WHERE id = $2", [
          id,
          previous.rows[0].id,
        ]);
      }
      await this.audit.append(client, {
        tenantId: input.tenantId,
        actorId: input.signedBy ?? null,
        action: "pre_anesthetic_assessment.signed",
        entityType: "pre_anesthetic_assessment",
        entityId: id,
        data: { caseId: input.caseId, version, asa: input.asa, decision: input.decision },
        justification: input.decisionReason?.trim() ?? null,
      });
      return { id, version };
    });
  }

  async currentAssessment(tenantId: string, caseId: string) {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query(
        "SELECT * FROM pre_anesthetic_assessment WHERE case_id = $1 AND superseded_by IS NULL",
        [caseId]
      );
      return result.rows[0] ?? null;
    });
  }

  // ---------- Ficha anestésica (F2-E6) ----------

  async openRecord(input: { tenantId: string; caseId: string; technique: string; openedBy?: string | null }) {
    return this.db.withTenant(input.tenantId, async (client) => {
      const surgeryCase = await this.requireCase(client, input.caseId);
      if (surgeryCase.status !== "in_room") {
        throw new BadRequestException(`Ficha anestésica exige caso em sala (atual: '${surgeryCase.status}')`);
      }
      const existing = await client.query("SELECT 1 FROM anesthetic_record WHERE case_id = $1", [input.caseId]);
      if (existing.rowCount) {
        throw new BadRequestException("Já existe ficha anestésica para este caso");
      }
      const inserted = await client.query(
        "INSERT INTO anesthetic_record (tenant_id, case_id, technique) VALUES ($1, $2, $3) RETURNING id, started_at",
        [input.tenantId, input.caseId, input.technique.trim()]
      );
      await this.audit.append(client, {
        tenantId: input.tenantId,
        actorId: input.openedBy ?? null,
        action: "anesthetic_record.opened",
        entityType: "anesthetic_record",
        entityId: inserted.rows[0].id,
        data: { caseId: input.caseId, technique: input.technique.trim() },
      });
      return { id: inserted.rows[0].id as string, startedAt: inserted.rows[0].started_at as Date };
    });
  }

  /** Evento na linha temporal. Registro retroativo é permitido e fica marcado. */
  async addEvent(input: {
    tenantId: string;
    recordId: string;
    eventType: AnestheticEventType;
    payload: Record<string, unknown>;
    occurredAt?: string; // ISO; ausente = agora
    recordedBy?: string | null;
  }): Promise<{ id: string; retroactive: boolean }> {
    return this.db.withTenant(input.tenantId, async (client) => {
      const record = await this.requireOpenRecord(client, input.recordId);
      const occurredAt = input.occurredAt ?? new Date().toISOString();
      if (new Date(occurredAt).getTime() < new Date(record.started_at).getTime() - PRE_START_WINDOW_MS) {
        throw new BadRequestException("Evento anterior à janela retroativa permitida (60 min antes da abertura da ficha)");
      }
      const inserted = await client.query(
        `INSERT INTO anesthetic_event (tenant_id, record_id, event_type, occurred_at, payload, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, occurred_at, recorded_at`,
        [input.tenantId, input.recordId, input.eventType, occurredAt, input.payload, input.recordedBy ?? null]
      );
      const row = inserted.rows[0];
      const retroactive =
        new Date(row.recorded_at).getTime() - new Date(row.occurred_at).getTime() > RETROACTIVE_TOLERANCE_MS;
      return { id: row.id, retroactive };
    });
  }

  /**
   * Correção sem apagar: evento de ANULAÇÃO aponta para o original, com
   * justificativa. A linha temporal preserva ambos (princípio 2).
   */
  async annulEvent(input: {
    tenantId: string;
    recordId: string;
    eventId: string;
    justification: string;
    annulledBy?: string | null;
  }): Promise<{ id: string }> {
    if (input.justification.trim().length < 5) {
      throw new BadRequestException("Anulação de evento exige justificativa");
    }
    return this.db.withTenant(input.tenantId, async (client) => {
      await this.requireOpenRecord(client, input.recordId);
      const original = await client.query(
        "SELECT event_type FROM anesthetic_event WHERE id = $1 AND record_id = $2",
        [input.eventId, input.recordId]
      );
      if (!original.rowCount) {
        throw new NotFoundException("Evento original não encontrado nesta ficha");
      }
      if (original.rows[0].event_type === "annulment") {
        throw new BadRequestException("Não é possível anular uma anulação");
      }
      const inserted = await client.query(
        `INSERT INTO anesthetic_event (tenant_id, record_id, event_type, occurred_at, payload, recorded_by, annuls)
         VALUES ($1, $2, 'annulment', now(), $3, $4, $5) RETURNING id`,
        [input.tenantId, input.recordId, { justification: input.justification.trim() }, input.annulledBy ?? null, input.eventId]
      );
      await this.audit.append(client, {
        tenantId: input.tenantId,
        actorId: input.annulledBy ?? null,
        action: "anesthetic_event.annulled",
        entityType: "anesthetic_event",
        entityId: input.eventId,
        justification: input.justification.trim(),
      });
      return { id: inserted.rows[0].id };
    });
  }

  async closeRecord(input: { tenantId: string; recordId: string; closedBy?: string | null }): Promise<void> {
    await this.db.withTenant(input.tenantId, async (client) => {
      await this.requireOpenRecord(client, input.recordId);
      await client.query("UPDATE anesthetic_record SET closed_at = now(), closed_by = $1 WHERE id = $2", [
        input.closedBy ?? null,
        input.recordId,
      ]);
      await this.audit.append(client, {
        tenantId: input.tenantId,
        actorId: input.closedBy ?? null,
        action: "anesthetic_record.closed",
        entityType: "anesthetic_record",
        entityId: input.recordId,
      });
    });
  }

  /** Linha temporal com anulações resolvidas (evento anulado vem marcado). */
  async timeline(tenantId: string, recordId: string) {
    return this.db.withTenant(tenantId, async (client) => {
      const events = await client.query(
        `SELECT e.*, (a.id IS NOT NULL) AS annulled,
                (e.recorded_at - e.occurred_at > interval '60 seconds') AS retroactive
         FROM anesthetic_event e
         LEFT JOIN anesthetic_event a ON a.annuls = e.id
         WHERE e.record_id = $1
         ORDER BY e.occurred_at ASC, e.recorded_at ASC`,
        [recordId]
      );
      return events.rows;
    });
  }

  // ---------- Recuperação pós-anestésica (F2-E7) ----------

  async admitToPacu(input: { tenantId: string; caseId: string; admittedBy?: string | null }): Promise<{ id: string }> {
    return this.db.withTenant(input.tenantId, async (client) => {
      const surgeryCase = await this.requireCase(client, input.caseId);
      if (surgeryCase.status !== "in_pacu") {
        throw new BadRequestException(`Admissão na RPA exige caso em 'in_pacu' (atual: '${surgeryCase.status}')`);
      }
      const inserted = await client.query(
        "INSERT INTO pacu_stay (tenant_id, case_id) VALUES ($1, $2) RETURNING id",
        [input.tenantId, input.caseId]
      );
      await this.audit.append(client, {
        tenantId: input.tenantId,
        actorId: input.admittedBy ?? null,
        action: "pacu.admitted",
        entityType: "pacu_stay",
        entityId: inserted.rows[0].id,
        data: { caseId: input.caseId },
      });
      return { id: inserted.rows[0].id };
    });
  }

  async observe(input: {
    tenantId: string;
    stayId: string;
    aldrete: number;
    pain: number;
    vitals: Record<string, unknown>;
    observedBy?: string | null;
  }): Promise<void> {
    await this.db.withTenant(input.tenantId, async (client) => {
      const stay = await client.query("SELECT discharged_at FROM pacu_stay WHERE id = $1 FOR UPDATE", [input.stayId]);
      if (!stay.rowCount) {
        throw new NotFoundException("Estadia de RPA não encontrada");
      }
      if (stay.rows[0].discharged_at) {
        throw new BadRequestException("Paciente já recebeu alta da RPA");
      }
      await client.query(
        "INSERT INTO pacu_observation (tenant_id, stay_id, aldrete, pain, vitals, observed_by) VALUES ($1, $2, $3, $4, $5, $6)",
        [input.tenantId, input.stayId, input.aldrete, input.pain, input.vitals, input.observedBy ?? null]
      );
    });
  }

  /**
   * Alta da RPA por critérios (Aldrete ≥ 9 e dor ≤ 3 na última observação).
   * Alta SEM critérios atingidos exige justificativa médica — e fica auditada
   * como alta antecipada.
   */
  async discharge(input: {
    tenantId: string;
    stayId: string;
    justification?: string;
    dischargedBy?: string | null;
  }): Promise<{ criteriaMet: boolean }> {
    return this.db.withTenant(input.tenantId, async (client) => {
      const stay = await client.query("SELECT case_id, discharged_at FROM pacu_stay WHERE id = $1 FOR UPDATE", [
        input.stayId,
      ]);
      if (!stay.rowCount) {
        throw new NotFoundException("Estadia de RPA não encontrada");
      }
      if (stay.rows[0].discharged_at) {
        throw new BadRequestException("Alta já registrada");
      }
      const last = await client.query(
        "SELECT aldrete, pain FROM pacu_observation WHERE stay_id = $1 ORDER BY observed_at DESC LIMIT 1",
        [input.stayId]
      );
      if (!last.rowCount) {
        throw new BadRequestException("Alta exige ao menos uma observação registrada");
      }
      const criteriaMet =
        last.rows[0].aldrete >= DISCHARGE_CRITERIA.minAldrete && last.rows[0].pain <= DISCHARGE_CRITERIA.maxPain;
      if (!criteriaMet && !input.justification?.trim()) {
        throw new BadRequestException({
          message: "Critérios de alta não atingidos: justificativa médica obrigatória",
          lastObservation: last.rows[0],
          criteria: DISCHARGE_CRITERIA,
        });
      }
      await client.query(
        "UPDATE pacu_stay SET discharged_at = now(), discharged_by = $1, discharge_justification = $2 WHERE id = $3",
        [input.dischargedBy ?? null, input.justification?.trim() ?? null, input.stayId]
      );
      await this.audit.append(client, {
        tenantId: input.tenantId,
        actorId: input.dischargedBy ?? null,
        action: criteriaMet ? "pacu.discharged" : "pacu.discharged_early",
        entityType: "pacu_stay",
        entityId: input.stayId,
        data: { criteriaMet, lastObservation: last.rows[0] },
        justification: input.justification?.trim() ?? null,
      });
      return { criteriaMet };
    });
  }

  // ---------- helpers ----------

  private async requireCase(client: PoolClient, caseId: string) {
    const result = await client.query("SELECT * FROM surgery_case WHERE id = $1", [caseId]);
    if (!result.rowCount) {
      throw new NotFoundException("Caso cirúrgico não encontrado");
    }
    return result.rows[0];
  }

  private async requireOpenRecord(client: PoolClient, recordId: string) {
    const result = await client.query("SELECT * FROM anesthetic_record WHERE id = $1 FOR UPDATE", [recordId]);
    if (!result.rowCount) {
      throw new NotFoundException("Ficha anestésica não encontrada");
    }
    if (result.rows[0].closed_at) {
      throw new BadRequestException("Ficha anestésica já encerrada");
    }
    return result.rows[0];
  }
}
