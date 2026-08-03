import { Injectable } from "@nestjs/common";
import { DbService } from "../db/db.service";

export type IndicatorDictionary = {
  definition: string;
  formula: string;
  source: string;
  period: string;
  limitations: string;
};

export type Indicator = {
  id: string;
  name: string;
  value: number | { cause: string; count: number }[];
  unit: string;
  dictionary: IndicatorDictionary;
};

/**
 * Indicadores do centro cirúrgico (F2-E8). Regra de governança de dados:
 * NENHUM indicador é publicado sem dicionário — definição, fórmula, fonte,
 * período e limitações viajam junto com o valor, sempre.
 */
@Injectable()
export class IndicatorsService {
  constructor(private readonly db: DbService) {}

  async surgicalCenterReport(tenantId: string, from: string, to: string): Promise<Indicator[]> {
    const period = `${from} a ${to}`;
    return this.db.withTenant(tenantId, async (client) => {
      const completed = await client.query(
        `SELECT count(*)::int AS n FROM case_status_event
         WHERE to_status = 'completed' AND occurred_at >= $1 AND occurred_at < $2`,
        [from, to]
      );

      const cancellations = await client.query(
        `SELECT sc.cancel_reason AS cause, count(*)::int AS count
         FROM case_status_event e JOIN surgery_case sc ON sc.id = e.case_id
         WHERE e.to_status = 'cancelled' AND e.occurred_at >= $1 AND e.occurred_at < $2
         GROUP BY sc.cancel_reason ORDER BY count DESC`,
        [from, to]
      );

      const adherence = await client.query(
        `WITH done AS (
           SELECT e.case_id
           FROM case_status_event e
           WHERE e.to_status = 'completed' AND e.occurred_at >= $1 AND e.occurred_at < $2
         )
         SELECT
           count(*)::int AS total,
           count(*) FILTER (WHERE (
             SELECT count(DISTINCT phase) FROM checklist_execution ce WHERE ce.case_id = done.case_id
           ) = 3)::int AS with_full_checklist
         FROM done`,
        [from, to]
      );

      const pacu = await client.query(
        `SELECT COALESCE(round(avg(EXTRACT(EPOCH FROM (discharged_at - admitted_at)) / 60))::int, 0) AS avg_minutes
         FROM pacu_stay
         WHERE discharged_at IS NOT NULL AND admitted_at >= $1 AND admitted_at < $2`,
        [from, to]
      );

      const total: number = adherence.rows[0].total;
      const withChecklist: number = adherence.rows[0].with_full_checklist;

      return [
        {
          id: "surgeries_completed",
          name: "Cirurgias realizadas",
          value: completed.rows[0].n,
          unit: "casos",
          dictionary: {
            definition: "Total de casos que atingiram o status Concluído no período.",
            formula: "Contagem de eventos de jornada com to_status = completed.",
            source: "case_status_event (jornada perioperatória).",
            period,
            limitations: "Não inclui procedimentos realizados fora do fluxo de caso cirúrgico.",
          },
        },
        {
          id: "cancellations_by_cause",
          name: "Cancelamentos por causa",
          value: cancellations.rows,
          unit: "casos",
          dictionary: {
            definition: "Casos cancelados no período, agrupados pela causa registrada.",
            formula: "Contagem de eventos to_status = cancelled agrupada por cancel_reason.",
            source: "case_status_event + surgery_case.cancel_reason (causa obrigatória ao cancelar).",
            period,
            limitations: "A causa é texto livre nesta versão; padronização por catálogo entra com o piloto.",
          },
        },
        {
          id: "checklist_adherence",
          name: "Adesão ao checklist de cirurgia segura",
          value: total === 0 ? 0 : Math.round((withChecklist / total) * 100),
          unit: "%",
          dictionary: {
            definition: "Percentual de casos concluídos com as 3 fases do checklist executadas.",
            formula: "Casos concluídos com sign_in + time_out + sign_out ÷ casos concluídos × 100.",
            source: "checklist_execution + case_status_event.",
            period,
            limitations: "Checklist parcial (1–2 fases) conta como não adesão.",
          },
        },
        {
          id: "avg_pacu_minutes",
          name: "Tempo médio em RPA",
          value: pacu.rows[0].avg_minutes,
          unit: "min",
          dictionary: {
            definition: "Permanência média entre admissão e alta da RPA.",
            formula: "Média de (discharged_at − admitted_at) das estadias encerradas, em minutos.",
            source: "pacu_stay (módulo de recuperação pós-anestésica).",
            period,
            limitations: "Estadias ainda abertas e transferências diretas para UTI não entram no cálculo.",
          },
        },
      ];
    });
  }
}
