import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { DbService } from "../db/db.service";

export type ChecklistPhase = "sign_in" | "time_out" | "sign_out";
export type ChecklistAnswer = { item: string; answer: "yes" | "no" | "not_applicable"; justification?: string };

/**
 * Itens por fase (prompt mestre §6.4, OMS adaptado). Parametrização por
 * instituição entra quando houver piloto; o conjunto abaixo é o mínimo seguro.
 */
export const CHECKLIST_ITEMS: Record<ChecklistPhase, string[]> = {
  sign_in: [
    "Identidade do paciente confirmada",
    "Procedimento e lateralidade confirmados",
    "Consentimento verificado",
    "Sítio cirúrgico demarcado",
    "Jejum confirmado",
    "Alergias verificadas",
    "Risco de via aérea avaliado",
    "Risco de sangramento avaliado",
    "Avaliação pré-anestésica revisada",
  ],
  time_out: [
    "Apresentação da equipe realizada",
    "Paciente, procedimento e sítio confirmados pela equipe",
    "Antibiótico profilático administrado (ou não indicado)",
    "Exames de imagem disponíveis (ou não necessários)",
    "Materiais e OPME conferidos",
    "Riscos críticos verbalizados (anestesia e cirurgia)",
  ],
  sign_out: [
    "Procedimento realizado registrado",
    "Contagem de compressas e instrumentais correta",
    "Amostras identificadas (ou não houve)",
    "Intercorrências registradas (ou não houve)",
    "Plano pós-operatório e destino comunicados",
  ],
};

const PHASE_ORDER: ChecklistPhase[] = ["sign_in", "time_out", "sign_out"];

/** Fases exigem o caso na sala (sign_in aceito também no preparo). */
const ALLOWED_STATUS: Record<ChecklistPhase, string[]> = {
  sign_in: ["in_preparation", "in_room"],
  time_out: ["in_room"],
  sign_out: ["in_room"],
};

@Injectable()
export class ChecklistService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService
  ) {}

  /**
   * Executa uma fase completa do checklist. Regras de segurança clínica:
   * fases na ordem (sign_in → time_out → sign_out), TODOS os itens
   * respondidos, não conformidade exige justificativa, uma execução por fase.
   */
  async executePhase(input: {
    tenantId: string;
    caseId: string;
    phase: ChecklistPhase;
    answers: ChecklistAnswer[];
    executedBy?: string | null;
  }): Promise<{ executionId: string; nonConformities: number }> {
    const expected = CHECKLIST_ITEMS[input.phase];
    const answered = new Map(input.answers.map((a) => [a.item, a]));
    const missing = expected.filter((item) => !answered.has(item));
    if (missing.length > 0) {
      throw new BadRequestException({ message: "Checklist incompleto: todos os itens devem ser respondidos", missing });
    }
    for (const answer of input.answers) {
      if (!expected.includes(answer.item)) {
        throw new BadRequestException(`Item desconhecido para a fase ${input.phase}: '${answer.item}'`);
      }
      if (answer.answer === "no" && !answer.justification?.trim()) {
        throw new BadRequestException(`Não conformidade em '${answer.item}' exige justificativa`);
      }
    }

    return this.db.withTenant(input.tenantId, async (client) => {
      const surgeryCase = await client.query("SELECT status FROM surgery_case WHERE id = $1 FOR UPDATE", [input.caseId]);
      if (!surgeryCase.rowCount) {
        throw new NotFoundException("Caso cirúrgico não encontrado");
      }
      if (!ALLOWED_STATUS[input.phase].includes(surgeryCase.rows[0].status)) {
        throw new BadRequestException(
          `Fase '${input.phase}' exige caso em ${ALLOWED_STATUS[input.phase].join("/")} (atual: '${surgeryCase.rows[0].status}')`
        );
      }

      const done = await client.query("SELECT phase FROM checklist_execution WHERE case_id = $1", [input.caseId]);
      const donePhases = new Set(done.rows.map((r) => r.phase as ChecklistPhase));
      if (donePhases.has(input.phase)) {
        throw new BadRequestException(`Fase '${input.phase}' já executada para este caso`);
      }
      const position = PHASE_ORDER.indexOf(input.phase);
      const previousMissing = PHASE_ORDER.slice(0, position).filter((phase) => !donePhases.has(phase));
      if (previousMissing.length > 0) {
        throw new BadRequestException(`Fase '${input.phase}' exige fases anteriores completas: ${previousMissing.join(", ")}`);
      }

      const execution = await client.query(
        "INSERT INTO checklist_execution (tenant_id, case_id, phase, executed_by) VALUES ($1, $2, $3, $4) RETURNING id",
        [input.tenantId, input.caseId, input.phase, input.executedBy ?? null]
      );
      const executionId: string = execution.rows[0].id;
      let nonConformities = 0;
      for (const answer of input.answers) {
        if (answer.answer === "no") nonConformities += 1;
        await client.query(
          "INSERT INTO checklist_answer (tenant_id, execution_id, item, answer, justification) VALUES ($1, $2, $3, $4, $5)",
          [input.tenantId, executionId, answer.item, answer.answer, answer.justification?.trim() ?? null]
        );
      }
      await this.audit.append(client, {
        tenantId: input.tenantId,
        actorId: input.executedBy ?? null,
        action: `checklist.${input.phase}_completed`,
        entityType: "surgery_case",
        entityId: input.caseId,
        data: { executionId, nonConformities, items: expected.length },
      });
      return { executionId, nonConformities };
    });
  }

  /** Adesão do caso: fases completas e pendentes. */
  async adherence(tenantId: string, caseId: string): Promise<{ completed: ChecklistPhase[]; pending: ChecklistPhase[] }> {
    return this.db.withTenant(tenantId, async (client) => {
      const done = await client.query("SELECT phase FROM checklist_execution WHERE case_id = $1", [caseId]);
      const completed = done.rows.map((r) => r.phase as ChecklistPhase);
      return { completed, pending: PHASE_ORDER.filter((p) => !completed.includes(p)) };
    });
  }
}

/** Respostas "tudo conforme" para uso em testes e seeds sintéticos. */
export function allYes(phase: ChecklistPhase): ChecklistAnswer[] {
  return CHECKLIST_ITEMS[phase].map((item) => ({ item, answer: "yes" as const }));
}
