# CLAUDE.md — ANESTBOT Platform

Regras permanentes para qualquer sessão de trabalho neste repositório.
O prompt completo está em `PROMPT-MESTRE-CLAUDE-CODE-ANESTBOT.md`. Estado vivo
em `docs/STATUS.md`; decisões em `docs/DECISIONS.md`; riscos em `docs/RISKS.md`.

## O que é este repositório

- **`anestbot2/`** — bot de triagem pré-anestésica no WhatsApp, **EM PRODUÇÃO**
  (Railway + UltraMsg + Claude API). Node.js 20 + Express, JS puro, ESM.
  Estado em arquivo JSON num volume persistente (`/data`). 1 réplica só.
- **`apps/`, `packages/`** — plataforma SaaS em construção (TypeScript estrito).
- **`docs/`** — baseline, status, decisões, riscos, arquitetura.

## Regras invioláveis

1. **Nunca** fazer merge na main, deploy, alterar produção/segredos reais, ou
   executar ações destrutivas (`git reset --hard`, `git clean -fd`, exclusões
   amplas) sem autorização explícita do dono do repo.
2. Trabalhar SEMPRE na branch isolada (`claude/anestbot-platform-efo1c0`),
   commits pequenos, só após testes verdes. Não remover testes para ficar verde.
3. **O bot em produção é intocável em comportamento** sem validação: preservar
   portão xxxx/❌❌❌❌, webhook-first, roteamento de mídia atrasada, dedup,
   watchdog, orçamento de payload, timeouts, comandos, nome do arquivo de estado
   (`anestbot2-store.json`) e compatibilidade com o volume `/data` e o deploy
   Railway atual. Mudanças de endurecimento devem ser retrocompatíveis
   (fail-safe quando env nova não existir — com aviso alto no boot).
4. **PHI/logs:** nunca logar anamnese, exames, parecer, nome de paciente ou
   qualquer conteúdo clínico. Logar apenas metadados (contagens, tamanhos, ids
   técnicos). Nunca usar dados reais de pacientes em dev, seeds, testes ou CI.
5. **Segurança:** nada de segredo em código/commit/log/exemplo; tenant e
   autorização derivam da sessão no backend (nunca do cliente); acesso negado
   falha fechado; webhooks exigem segredo/assinatura + timestamp + idempotência
   + limite de payload.
6. **Clínico:** o bot/plataforma é apoio à decisão — a decisão final é do médico
   identificado. Nunca inventar valor de exame; arquivo não visto nunca é
   descrito como visto; na dúvida, "ilegível — reenviar". IA nunca libera nem
   veta cirurgia automaticamente.
7. Dinheiro em centavos inteiros; datas armazenadas em UTC, exibidas em
   America/Sao_Paulo (dd/mm/aaaa); UI em pt-BR.

## Comandos

```bash
# Bot (produção)
cd anestbot2 && npm ci && npm test        # suíte completa (obrigatória antes de commit)

# Plataforma (a partir do Marco 2)
cd apps/api && npm ci && npm test && npm run typecheck
```

## Fluxo de retomada de sessão

1. Ler `CLAUDE.md` (este arquivo) → `docs/STATUS.md` → `docs/DECISIONS.md`.
2. `git log --oneline -10` e `git status` para ver onde parou.
3. Continuar o marco registrado em STATUS.md. Não refazer trabalho concluído.
4. Antes de encerrar: atualizar `docs/STATUS.md` (último commit, testes, próximo passo).

## Marcos (ordem obrigatória)

0. Baseline e proteção do bot (webhook auth, admin fail-closed, /ready, logs sem PHI).
1. Integração confiável (contratos, outbox HMAC, retry, dead-letter, idempotência).
2. Núcleo SaaS (monorepo, PostgreSQL, auth, tenants, RBAC, casos, auditoria).
3. Prontuário anestésico (pré/intra/pós, assinatura, hash, adendos, PDF).
4. Faturamento (TUSS/CBHPM autorizadas, memória de cálculo, glosas).
5. Conhecimento e comercial (biblioteca, planos, trial, onboarding).
