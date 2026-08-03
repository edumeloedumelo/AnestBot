# Estado do Projeto — Hospital OS

> Documento vivo. Atualizado a cada entrega relevante.
> Última atualização: 2026-08-03 · Fase 1 (Fundação) — primeiro incremento entregue

## Situação atual

- **Fase**: 1 — Fundação, iniciada após homologação humana da Fase 0
  (registrada em DECISIONS.md). Primeiro incremento entregue e testado:
  - Monorepo (`package.json` workspaces): `apps/api` (NestJS) +
    `packages/database` (migrations SQL + runner com checksum).
  - **Trilha de auditoria imutável** (F1-E3): append-only por trigger e por
    privilégio, hash encadeado por tenant, `verifyChain()` detecta adulteração.
  - **Identidade** (F1-E2, parcial): login com senha (bcrypt) + MFA TOTP,
    JWT 15 min, RBAC por papel com vigência, acesso emergencial com
    justificativa obrigatória auditada. Eventos de login (sucesso/falha)
    auditados.
  - **Multi-tenancy RLS** (ADR-009): políticas `FORCE ROW LEVEL SECURITY` em
    todas as tabelas de domínio; papel de aplicação sem bypass
    (`0004_app_role.sql`) — a aplicação nunca conecta como superusuário.
  - **Organizações** (F1-E4, parcial): hierarquia organização/unidade/setor/
    sala/leito com criação auditada e restrita a admin.
  - **Qualidade**: 11 testes de integração contra PostgreSQL 16 real
    (migrations, imutabilidade, tamper-detection, RLS, auth/MFA, RBAC),
    lint + typecheck + build verdes, CI GitHub Actions com serviço Postgres.
- **Protótipo** (`prototype/`): entregue na Fase 0; aguarda sessões de
  usabilidade com usuários reais (opcional antes da Fase 2, recomendado).
- **AnestBot** (raiz do repo): intocado, operante (ADR-002).

- **Pacientes (F1-E5) — entregue**: cadastro com prontuário sequencial por
  tenant, validação de CPF por dígito verificador, deduplicação no fluxo
  (mesmo documento; nome semelhante + mesma data de nascimento, com
  normalização pt-BR e similaridade tolerante a partículas/abreviações/erros
  de digitação), criação bloqueada em duplicidade sem justificativa auditada,
  busca por nome/prontuário/CPF e mesclagem auditada sem perda de dados
  (origem inativa apontando para o sobrevivente).

## Fase 1 — itens restantes (próximos incrementos)

- F1-E2: bloqueio por inatividade, delegação temporária, revisão periódica de
  acessos, refresh tokens/sessões revogáveis.
- F1-E4: importação de tabelas TUSS/CBHPM com vigência; convênios; equipes.
- F1-E6: design system clínico (`packages/ui`), extraindo padrões do protótipo.
- F1-E1: ambientes staging/homolog e IaC (depende de D-03 → contrato piloto).

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

1. **D-02: instituição-piloto** — bloqueia o piloto da Fase 2, não o código.
2. **D-06: capacidade real de execução** — calibragem de prazos e homologadores.

## Próximos passos

1. Continuar Fase 1: cadastro de paciente com deduplicação (F1-E5) e
   importação TUSS/CBHPM (F1-E4) — próximos incrementos de maior valor.
2. Rodar sessões de usabilidade do protótipo (PROTOTYPE_SPEC.md §4) em
   paralelo, alimentando o design system (F1-E6).
3. Buscar resposta para D-02 (instituição-piloto).

## Histórico

| Data | Evento |
|---|---|
| 2026-08-03 | Fase 0 executada: análise crítica do prompt mestre + 12 documentos de fundação criados. |
| 2026-08-03 | Protótipo navegável construído (`prototype/`): 8 telas, Next.js + Tailwind, dados sintéticos, build e verificação visual concluídos. |
| 2026-08-03 | Fase 0 homologada pelo responsável humano; ADR-009 (RLS) e ADR-010 (hospedagem BR) registrados. |
| 2026-08-03 | Fase 1 iniciada: monorepo, auditoria imutável com hash encadeado, identidade (senha+MFA+RBAC), organizações, RLS com papel de aplicação sem bypass; 11 testes de integração verdes; CI configurado. |
| 2026-08-03 | F1-E5 entregue: cadastro de paciente com deduplicação (documento + nome/nascimento), prontuário sequencial, validação de CPF, mesclagem auditada; suíte em 32 testes verdes. |
