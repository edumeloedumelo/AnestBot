# Estado do Projeto — Hospital OS

> Documento vivo. Atualizado a cada entrega relevante.
> Última atualização: 2026-08-03 · Fase 2 (MVP perioperatório) — backend do núcleo clínico entregue

## Resumo executivo do estado das fases

| Fase | Estado |
|---|---|
| 0 — Descoberta | ✅ Concluída e homologada |
| 1 — Fundação | ✅ Concluída para desenvolvimento (threat model em `THREAT_MODEL.md`; pendências de hardening listadas lá bloqueiam o PILOTO, não o desenvolvimento) |
| 2 — MVP perioperatório | 🟡 **Backend do núcleo clínico entregue e testado** (domínio cirúrgico, checklist, anestesia, RPA, indicadores). Faltam: frontend real (`apps/web`, evoluindo o protótipo), tempo real (WebSocket), triagem de exames por IA (`apps/ai`), seeds/piloto |
| 3 — Expansão assistencial | ⛔ Bloqueada por gates externos (ver abaixo) — especificada em MODULES/ROADMAP |
| 4 — Gestão completa | ⛔ Depende da Fase 3 e de credenciamento TISS real |
| 5 — IA e automação | ⛔ Depende de dados reais de produção (Fases 2–4) para qualquer modelo preditivo |

### Gates externos que impedem "executar tudo" de uma vez (honestidade de escopo)

1. **D-02 — instituição-piloto**: sem um centro cirúrgico real, não há
   homologação clínica válida, dados de produção nem credenciamento TISS.
2. **D-07 — base de conhecimento farmacológico licenciada**: pré-requisito
   inegociável da prescrição eletrônica (Fase 3). Construir interações
   medicamentosas "na mão" é inseguro (R-04) e não será feito.
3. **Infraestrutura contratada** (D-03 executado): staging/homolog/prod reais,
   assinatura digital ICP-Brasil (D-04) e pentest externo antes de produção.
4. **Homologação humana** (princípio 12): nenhum módulo clínico entra em
   produção sem validação por profissionais reais — não simulável.

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

- **Cadastros mestres (F1-E4) — entregue**: procedimentos TUSS/CBHPM/SIGTAP/
  LOCAL com vigência (importação com semântica de supersede preservando
  histórico; sobreposição de vigências impossível por constraint de exclusão
  no banco; busca vigente-na-data; histórico por código) e convênios com
  registro ANS, unicidade por tenant e desativação auditada.

## Fase 1 — itens restantes (próximos incrementos)

- F1-E2: bloqueio por inatividade, delegação temporária, revisão periódica de
  acessos, refresh tokens/sessões revogáveis.
- F1-E6: design system clínico (`packages/ui`), extraindo padrões do protótipo.
- F1-E1: ambientes staging/homolog e IaC (depende de D-03 → contrato piloto).

Com F1-E4 e F1-E5 entregues, as dependências de dados do agendamento
cirúrgico (Fase 2) estão prontas: paciente + procedimento vigente + convênio.

## Fase 2 — backend do núcleo clínico (entregue nesta rodada)

- **Domínio cirúrgico** (`surgery`): solicitação com validações estruturais
  (equipe mínima, procedimento vigente, lateralidade, duração); agendamento
  sala × intervalo com **conflito de sala impossível por constraint de
  exclusão no banco** e conflito de equipe detectado com o caso conflitante;
  confirmação **bloqueada** com a lista exata de itens críticos faltantes;
  jornada de status com transições validadas e linha do tempo consultável;
  cancelamento com causa obrigatória que **libera o slot** da sala.
- **Checklist de cirurgia segura** (`checklist`): 3 fases na ordem
  obrigatória, completude exigida, não conformidade sem justificativa
  impossível (aplicação E constraint), execução única por fase, adesão
  calculável, tudo auditado. Registro clínico sem UPDATE por privilégio.
- **Anestesia** (`anesthesia`): avaliação pré-anestésica **versionada**
  (supersede, nunca apaga; adiamento exige motivo); ficha anestésica com
  eventos em linha temporal **append-only por privilégio** — correção é
  evento de anulação apontando o original, retroativo marcado
  automaticamente, janela retroativa de 60 min pré-abertura; RPA com
  observações seriadas, Aldrete, e alta por critérios (Aldrete ≥ 9, dor ≤ 3)
  ou justificativa médica auditada como alta antecipada.
- **Indicadores** (`analytics`): relatório do centro cirúrgico (volume,
  cancelamentos por causa, adesão ao checklist, tempo médio de RPA) em que
  **todo indicador viaja com seu dicionário** (definição, fórmula, fonte,
  período, limitações) — testado.
- **Qualidade**: 60 testes (8 suítes) contra PostgreSQL 16 real; lint,
  typecheck e build verdes; migrations 0007–0009.

### Fase 2 — restante para o critério de saída

1. `apps/web` real evoluindo o protótipo (as 8 telas contra a API).
2. Tempo real do mapa (gateway WebSocket + eventos de domínio).
3. Serviço `apps/ai` (FastAPI) com a triagem de exames herdada do AnestBot.
4. Seeds sintéticos completos + piloto em instituição real (gate D-02).

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
| 2026-08-03 | F1-E4 entregue: procedimentos com vigência (supersede + constraint de não-sobreposição) e convênios auditados; suíte em 38 testes verdes. |
| 2026-08-03 | Fase 1 fechada para desenvolvimento: THREAT_MODEL.md da fundação escrito (pendências de hardening bloqueiam piloto, não desenvolvimento). |
| 2026-08-03 | Fase 2 backend entregue: domínio cirúrgico (conflito de sala por constraint, itens críticos bloqueantes, jornada), checklist de cirurgia segura, anestesia (avaliação versionada, ficha append-only com anulação, RPA com critérios de alta) e indicadores com dicionário; 60 testes verdes. |
