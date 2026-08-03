# Estado do Projeto — Hospital OS

> Documento vivo. Atualizado a cada entrega relevante.
> Última atualização: 2026-08-03 · Fase 0 (Descoberta) — protótipo entregue

## Situação atual

- **Fase**: 0 — Descoberta. Artefatos documentais entregues e **protótipo
  navegável construído** (`prototype/`, 8 telas, build verde, telas verificadas
  visualmente). Aguardando: sessões de usabilidade com usuários reais e
  homologação humana.
- **Código do núcleo clínico**: nenhum, por decisão — o protótipo é descartável
  em lógica (sem backend, permissões ou auditoria) e serve só à validação de UX.
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
| Protótipo navegável implementado (Next.js, dados sintéticos) | `../prototype/` |

## Bloqueios ativos

1. **Homologação humana da Fase 0** — gate obrigatório.
2. **D-02: instituição-piloto** — decisão mais importante do projeto.
3. D-01 (tenancy), D-03 (hospedagem), D-06 (capacidade real) — bloqueiam
   Fase 1.

## Próximos passos (após homologação)

1. Responder decisões D-01/D-02/D-03/D-06.
2. Rodar sessões de usabilidade do protótipo (5–8 sessões por persona,
   critérios em PROTOTYPE_SPEC.md §4) e registrar os relatórios em `docs/`.
3. Iniciar Fase 1 (Fundação): monorepo, identidade, auditoria, cadastros.

## Histórico

| Data | Evento |
|---|---|
| 2026-08-03 | Fase 0 executada: análise crítica do prompt mestre + 12 documentos de fundação criados. |
| 2026-08-03 | Protótipo navegável construído (`prototype/`): 8 telas, Next.js + Tailwind, dados sintéticos, build e verificação visual concluídos. |
