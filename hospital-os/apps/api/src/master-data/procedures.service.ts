import { BadRequestException, Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { DbService } from "../db/db.service";

export type CodeSystem = "TUSS" | "CBHPM" | "SIGTAP" | "LOCAL";

export type ProcedureRow = {
  codeSystem: CodeSystem;
  code: string;
  description: string;
  validFrom: string; // yyyy-mm-dd
  validTo?: string | null;
};

export type ProcedureCode = ProcedureRow & { id: string; validTo: string | null };

export type ImportSummary = { inserted: number; superseded: number; skipped: number };

const MAX_IMPORT_ROWS = 10000;

function rowToProcedure(row: Record<string, unknown>): ProcedureCode {
  const toDate = (value: unknown): string | null =>
    value == null ? null : value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  return {
    id: row.id as string,
    codeSystem: row.code_system as CodeSystem,
    code: row.code as string,
    description: row.description as string,
    validFrom: toDate(row.valid_from)!,
    validTo: toDate(row.valid_to),
  };
}

/**
 * Procedimentos com vigência (F1-E4). Importação com semântica de
 * "nova versão da tabela a partir da data X": código já vigente com descrição
 * idêntica é mantido; com descrição diferente é SUPERSEDIDO (vigência anterior
 * encerrada em X, nova vigência aberta) — nunca sobrescrito, preservando o
 * histórico de que valia em cada data. Sobreposição de vigências é impossível
 * por constraint no banco (procedure_code_no_overlap).
 */
@Injectable()
export class ProceduresService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService
  ) {}

  async import(input: {
    tenantId: string;
    source: string; // rótulo da origem, ex.: "TUSS 2026-07"
    rows: ProcedureRow[];
    importedBy?: string | null;
  }): Promise<ImportSummary> {
    if (input.rows.length === 0) {
      throw new BadRequestException("Importação vazia");
    }
    if (input.rows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(`Importação limitada a ${MAX_IMPORT_ROWS} linhas por chamada`);
    }

    return this.db.withTenant(input.tenantId, async (client) => {
      const summary: ImportSummary = { inserted: 0, superseded: 0, skipped: 0 };
      for (const row of input.rows) {
        const current = await client.query(
          `SELECT id, description FROM procedure_code
           WHERE code_system = $1 AND code = $2
             AND valid_from <= $3 AND (valid_to IS NULL OR valid_to > $3)`,
          [row.codeSystem, row.code, row.validFrom]
        );
        if (current.rowCount) {
          if (current.rows[0].description === row.description) {
            summary.skipped += 1;
            continue;
          }
          await client.query("UPDATE procedure_code SET valid_to = $1 WHERE id = $2", [
            row.validFrom,
            current.rows[0].id,
          ]);
          summary.superseded += 1;
        }
        await client.query(
          `INSERT INTO procedure_code (tenant_id, code_system, code, description, valid_from, valid_to)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [input.tenantId, row.codeSystem, row.code, row.description.trim(), row.validFrom, row.validTo ?? null]
        );
        summary.inserted += 1;
      }
      await this.audit.append(client, {
        tenantId: input.tenantId,
        actorId: input.importedBy ?? null,
        action: "procedure_table.imported",
        entityType: "procedure_code",
        data: { source: input.source, ...summary, totalRows: input.rows.length },
      });
      return summary;
    });
  }

  /** Busca procedimentos VIGENTES na data informada (padrão: hoje). */
  async search(tenantId: string, query: string, onDate?: string): Promise<ProcedureCode[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const date = onDate ?? new Date().toISOString().slice(0, 10);
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM procedure_code
         WHERE valid_from <= $2 AND (valid_to IS NULL OR valid_to > $2)
           AND (code LIKE $1 || '%' OR description ILIKE '%' || $1 || '%')
         ORDER BY code ASC
         LIMIT 20`,
        [trimmed, date]
      );
      return result.rows.map(rowToProcedure);
    });
  }

  /** Histórico completo de vigências de um código (auditoria/faturamento). */
  async history(tenantId: string, codeSystem: CodeSystem, code: string): Promise<ProcedureCode[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const result = await client.query(
        "SELECT * FROM procedure_code WHERE code_system = $1 AND code = $2 ORDER BY valid_from ASC",
        [codeSystem, code]
      );
      return result.rows.map(rowToProcedure);
    });
  }
}
