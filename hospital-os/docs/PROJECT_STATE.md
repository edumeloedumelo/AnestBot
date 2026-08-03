# Estado do Projeto — Hospital OS

> Documento vivo. Atualizado a cada entrega relevante.
> Última atualização: 2026-08-03 · Fase 0 (Descoberta)

## Situação atual

- **Fase**: 0 — Descoberta. Artefatos produzidos, **aguardando homologação
  humana** (Etapa 5 da primeira missão).
- **Código do Hospital OS**: nenhum, por decisão (nenhum módulo crítico sem
  homologação prévia dos artefatos).
- **AnestBot** (raiz do repo): intocado, operante, reconhecido como ativo do
  projeto (ADR-002).

## O que foi entregue nesta fase

| Artefato | Arquivo |
|---|---|
| Visão de produto, proposta de valor, personas, mercado | `PRODUCT_VISION.md` |
| Mapa de módulos, domínios e dependências | `MODULES.md` |
| Arquitetura técnica com justificativas | `ARCHITECTURE.md` |
| Estratégia de dados + modelo conceitual do MVP | `DATA_MODEL.md` |
| Segurança, privacidade, conformidade, safety, IA | `SECURITY.md` |
| Governança multiagente + princípios + processo | `GOVERNANCE.md` |
| Roadmap Fases 0–5 com critérios de saída | `ROADMAP.md` |
| Backlog priorizado (Fase 1 e MVP) | `BACKLOG.md` |
| Registro de riscos (14 riscos + aceitos) | `RISKS.md` |
| 8 ADRs + 9 decisões pendentes | `DECISIONS.md` |
| Especificação do protótipo navegável (8 telas) | `PROTOTYPE_SPEC.md` |

## Bloqueios ativos

1. **Homologação humana da Fase 0** — gate obrigatório.
2. **D-02: instituição-piloto** — decisão mais importante do projeto.
3. D-01 (tenancy), D-03 (hospedagem), D-06 (capacidade real) — bloqueiam
   Fase 1.

## Próximos passos (após homologação)

1. Responder decisões D-01/D-02/D-03/D-06.
2. Construir protótipo navegável (PROTOTYPE_SPEC.md) e rodar sessões de
   usabilidade.
3. Iniciar Fase 1 (Fundação): monorepo, identidade, auditoria, cadastros.

## Histórico

| Data | Evento |
|---|---|
| 2026-08-03 | Fase 0 executada: análise crítica do prompt mestre + 12 documentos de fundação criados. |
