import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PoolClient } from "pg";
import { AuditService } from "../audit/audit.service";
import { DbService } from "../db/db.service";
import { isValidCnsFormat, isValidCpf, nameSimilarity, normalizeName, onlyDigits } from "./matching.util";

export type Patient = {
  id: string;
  mrn: string;
  fullName: string;
  birthDate: string; // yyyy-mm-dd
  sex: "F" | "M" | "O" | "U";
  cpf: string | null;
  cns: string | null;
  phone: string | null;
  active: boolean;
  mergedInto: string | null;
};

export type DuplicateReason = "same_cpf" | "same_cns" | "same_name" | "similar_name_same_birth_date";

export type DuplicateCandidate = { patient: Patient; reasons: DuplicateReason[]; nameScore: number };

export type CreatePatientInput = {
  tenantId: string;
  fullName: string;
  birthDate: string;
  sex?: "F" | "M" | "O" | "U";
  cpf?: string;
  cns?: string;
  phone?: string;
  createdBy?: string | null;
  /**
   * Criação com duplicidade candidata é bloqueada por padrão (a deduplicação é
   * parte do fluxo). Prosseguir exige justificativa, que fica auditada.
   */
  duplicateOverrideJustification?: string;
};

const SIMILARITY_THRESHOLD = 0.7;

function rowToPatient(row: Record<string, unknown>): Patient {
  return {
    id: row.id as string,
    mrn: row.mrn as string,
    fullName: row.full_name as string,
    birthDate:
      row.birth_date instanceof Date ? row.birth_date.toISOString().slice(0, 10) : String(row.birth_date),
    sex: row.sex as Patient["sex"],
    cpf: (row.cpf as string) ?? null,
    cns: (row.cns as string) ?? null,
    phone: (row.phone as string) ?? null,
    active: row.active as boolean,
    mergedInto: (row.merged_into as string) ?? null,
  };
}

@Injectable()
export class PatientsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService
  ) {}

  private validateDocuments(input: { cpf?: string; cns?: string }): { cpf: string | null; cns: string | null } {
    let cpf: string | null = null;
    let cns: string | null = null;
    if (input.cpf !== undefined && input.cpf !== "") {
      if (!isValidCpf(input.cpf)) {
        throw new BadRequestException("CPF inválido (dígitos verificadores não conferem)");
      }
      cpf = onlyDigits(input.cpf);
    }
    if (input.cns !== undefined && input.cns !== "") {
      if (!isValidCnsFormat(input.cns)) {
        throw new BadRequestException("CNS inválido (esperados 15 dígitos)");
      }
      cns = onlyDigits(input.cns);
    }
    return { cpf, cns };
  }

  /** Candidatos a duplicidade com os motivos: documento, nome, nome+nascimento. */
  async findDuplicates(input: {
    tenantId: string;
    fullName: string;
    birthDate: string;
    cpf?: string;
    cns?: string;
  }): Promise<DuplicateCandidate[]> {
    const nameNormalized = normalizeName(input.fullName);
    const cpf = input.cpf ? onlyDigits(input.cpf) : null;
    const cns = input.cns ? onlyDigits(input.cns) : null;

    return this.db.withTenant(input.tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM patient
         WHERE active
           AND ((cpf IS NOT NULL AND cpf = $1)
             OR (cns IS NOT NULL AND cns = $2)
             OR name_normalized = $3
             OR birth_date = $4)`,
        [cpf, cns, nameNormalized, input.birthDate]
      );

      const candidates: DuplicateCandidate[] = [];
      for (const row of result.rows) {
        const patient = rowToPatient(row);
        const reasons: DuplicateReason[] = [];
        const score = nameSimilarity(nameNormalized, row.name_normalized as string);
        if (cpf && row.cpf === cpf) reasons.push("same_cpf");
        if (cns && row.cns === cns) reasons.push("same_cns");
        if (row.name_normalized === nameNormalized) reasons.push("same_name");
        if (patient.birthDate === input.birthDate && score >= SIMILARITY_THRESHOLD && reasons.length === 0) {
          reasons.push("similar_name_same_birth_date");
        }
        if (reasons.length > 0) {
          candidates.push({ patient, reasons, nameScore: Number(score.toFixed(2)) });
        }
      }
      return candidates.sort((a, b) => b.nameScore - a.nameScore);
    });
  }

  async create(input: CreatePatientInput): Promise<Patient> {
    const { cpf, cns } = this.validateDocuments(input);
    const nameNormalized = normalizeName(input.fullName);
    if (!nameNormalized) {
      throw new BadRequestException("Nome do paciente é obrigatório");
    }

    const duplicates = await this.findDuplicates(input);
    const override = input.duplicateOverrideJustification?.trim();
    if (duplicates.length > 0 && !override) {
      throw new ConflictException({
        message: "Possível duplicidade de paciente. Use um cadastro existente ou justifique a criação.",
        candidates: duplicates.map((c) => ({ id: c.patient.id, mrn: c.patient.mrn, reasons: c.reasons })),
      });
    }

    return this.db.withTenant(input.tenantId, async (client) => {
      const mrn = await this.nextMrn(client, input.tenantId);
      const inserted = await client.query(
        `INSERT INTO patient (tenant_id, mrn, full_name, name_normalized, birth_date, sex, cpf, cns, phone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          input.tenantId,
          mrn,
          input.fullName.trim(),
          nameNormalized,
          input.birthDate,
          input.sex ?? "U",
          cpf,
          cns,
          input.phone ?? null,
        ]
      );
      const patient = rowToPatient(inserted.rows[0]);
      await this.audit.append(client, {
        tenantId: input.tenantId,
        actorId: input.createdBy ?? null,
        action: "patient.created",
        entityType: "patient",
        entityId: patient.id,
        data: {
          mrn,
          fullName: patient.fullName,
          birthDate: patient.birthDate,
          duplicateCandidatesOverridden: duplicates.map((c) => c.patient.id),
        },
        justification: override ?? null,
      });
      return patient;
    });
  }

  /** Busca por nome (normalizado), prontuário ou CPF. Só pacientes ativos. */
  async search(tenantId: string, query: string): Promise<Patient[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const digits = onlyDigits(trimmed);
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM patient
         WHERE active
           AND (($1 <> '' AND name_normalized LIKE '%' || $1 || '%')
             OR mrn = $2
             OR ($3 <> '' AND cpf = $3))
         ORDER BY name_normalized ASC
         LIMIT 20`,
        [normalizeName(trimmed), trimmed, digits]
      );
      return result.rows.map(rowToPatient);
    });
  }

  async get(tenantId: string, id: string): Promise<Patient> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query("SELECT * FROM patient WHERE id = $1", [id]);
      if (!result.rowCount) {
        throw new NotFoundException("Paciente não encontrado");
      }
      return rowToPatient(result.rows[0]);
    });
  }

  /**
   * Mesclagem auditada (F1-E5): o registro de origem fica inativo apontando
   * para o sobrevivente; nada é apagado e a justificativa é obrigatória.
   */
  async merge(input: {
    tenantId: string;
    sourceId: string;
    targetId: string;
    justification: string;
    mergedBy?: string | null;
  }): Promise<{ survivor: Patient }> {
    if (input.sourceId === input.targetId) {
      throw new BadRequestException("Origem e destino da mesclagem devem ser diferentes");
    }
    if (input.justification.trim().length < 10) {
      throw new BadRequestException("Justificativa da mesclagem é obrigatória (mínimo 10 caracteres)");
    }
    return this.db.withTenant(input.tenantId, async (client) => {
      const rows = await client.query("SELECT * FROM patient WHERE id = ANY($1) FOR UPDATE", [
        [input.sourceId, input.targetId],
      ]);
      if (rows.rowCount !== 2) {
        throw new NotFoundException("Paciente de origem ou destino não encontrado");
      }
      const source = rows.rows.find((r) => r.id === input.sourceId)!;
      const target = rows.rows.find((r) => r.id === input.targetId)!;
      if (!source.active || !target.active) {
        throw new BadRequestException("Mesclagem exige que ambos os cadastros estejam ativos");
      }

      await client.query("UPDATE patient SET active = false, merged_into = $1 WHERE id = $2", [
        input.targetId,
        input.sourceId,
      ]);
      await this.audit.append(client, {
        tenantId: input.tenantId,
        actorId: input.mergedBy ?? null,
        action: "patient.merged",
        entityType: "patient",
        entityId: input.sourceId,
        data: { mergedInto: input.targetId, sourceMrn: source.mrn, targetMrn: target.mrn },
        justification: input.justification.trim(),
      });
      const survivor = await client.query("SELECT * FROM patient WHERE id = $1", [input.targetId]);
      return { survivor: rowToPatient(survivor.rows[0]) };
    });
  }

  private async nextMrn(client: PoolClient, tenantId: string): Promise<string> {
    const counter = await client.query(
      `INSERT INTO tenant_counter (tenant_id, name, value) VALUES ($1, 'patient_mrn', 1)
       ON CONFLICT (tenant_id, name) DO UPDATE SET value = tenant_counter.value + 1
       RETURNING value`,
      [tenantId]
    );
    return String(counter.rows[0].value).padStart(6, "0");
  }
}
