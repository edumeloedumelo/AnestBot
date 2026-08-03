# Hospital OS

Sistema hospitalar inteligente, modular e orientado por múltiplos agentes.

**Status: Fase 1 — Fundação (em andamento). Fase 0 homologada em 2026-08-03.**

A fundação técnica está em construção: monorepo (`apps/api` NestJS +
`packages/database`), trilha de auditoria imutável com hash encadeado,
identidade (senha + MFA TOTP + RBAC contextual), estrutura organizacional e
isolamento de tenant por RLS — tudo coberto por testes de integração contra
PostgreSQL real e CI (`.github/workflows/hospital-os-ci.yml` na raiz do repo).
O núcleo clínico (Fase 2) só inicia após o critério de saída da Fase 1.

## O que existe neste repositório

| Caminho | Conteúdo |
|---|---|
| `/` (raiz) | **AnestBot** — app existente de triagem pré-anestésica (Base44 + React/Vite), em produção. Não foi alterado. |
| `/hospital-os/` | Artefatos do Hospital OS (este diretório). Por ora, apenas documentação de Fase 0. |

O AnestBot é um ativo do projeto: seu fluxo de triagem pré-operatória com IA é o
embrião funcional do módulo de Avaliação Pré-Anestésica (ver `docs/DECISIONS.md`,
ADR-002).

## Documentos de Fase 0

| Documento | Conteúdo |
|---|---|
| [docs/PRODUCT_VISION.md](docs/PRODUCT_VISION.md) | Visão, proposta de valor, personas, mercado inicial |
| [docs/MODULES.md](docs/MODULES.md) | Mapa completo de módulos, domínios e dependências |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arquitetura técnica inicial e justificativas |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Estratégia de dados e modelo conceitual do núcleo |
| [docs/SECURITY.md](docs/SECURITY.md) | Estratégia de segurança, privacidade e conformidade |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Fases 0–5 com critérios de saída |
| [docs/BACKLOG.md](docs/BACKLOG.md) | Backlog inicial priorizado (épicos e histórias do MVP) |
| [docs/GOVERNANCE.md](docs/GOVERNANCE.md) | Estrutura multiagente e fluxo de governança |
| [docs/PROTOTYPE_SPEC.md](docs/PROTOTYPE_SPEC.md) | Proposta do primeiro protótipo navegável |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Registro de decisões arquiteturais (ADRs) |
| [docs/RISKS.md](docs/RISKS.md) | Registro de riscos com severidade e mitigação |
| [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md) | Estado vivo do projeto — **comece por aqui** |

## Princípios inegociáveis (resumo)

1. Segurança do paciente acima de velocidade ou conveniência.
2. Dados clínicos nunca são alterados ou apagados sem rastreabilidade (auditoria imutável, append-only).
3. IA nunca decide clinicamente; toda sugestão é identificada como sugestão e exige validação humana.
4. Nenhum dado ausente é inventado.
5. Nenhum módulo crítico entra em produção sem homologação humana.
6. Privacy by design, security by design, safety by design.

A lista completa (15 princípios) está registrada em `docs/GOVERNANCE.md`.

## Próxima ação

Homologação humana dos artefatos de Fase 0 e resposta às decisões bloqueadoras
listadas em `docs/DECISIONS.md` (seção "Decisões pendentes"). Só então inicia a
Fase 1 (Fundação).
