# STATUS — estado vivo do projeto

> Atualize este arquivo ao fim de cada marco e antes de encerrar qualquer sessão.

**Última atualização:** 04/08/2026 · **Branch:** `claude/anestbot-platform-efo1c0`

## Onde estamos

- [x] Auditoria do repositório e leitura integral do código do bot
- [x] Baseline executado e registrado (`docs/BASELINE.md`) — 76 testes ✅, audit ✅
- [x] Documentação operacional criada (CLAUDE.md, PROMPT-MESTRE, docs/*)
- [ ] **Marco 0 — baseline e proteção** ← EM ANDAMENTO
- [ ] Marco 1 — integração confiável (outbox/HMAC/idempotência)
- [ ] Marco 2 — núcleo SaaS (monorepo, PostgreSQL, auth, tenants, RBAC)
- [ ] Marco 3 — prontuário anestésico
- [ ] Marco 4 — faturamento
- [ ] Marco 5 — conhecimento e comercial

## Último commit / testes

- Commit: (ver `git log --oneline -5`)
- Testes bot: `cd anestbot2 && npm test` → 76/76 ✅ (baseline pré-Marco 0)

## Próximo passo imediato

Implementar Marco 0 no bot (`anestbot2/`):
1. `WEBHOOK_TOKEN` com comparação constant-time (401 sem token quando configurado).
2. Admin fail-closed (`ADMIN_NUMBERS` vazio ⇒ só `fromMe`).
3. `/ready` (readiness) e `/diag` (protegido por `DIAG_TOKEN`, fail-closed, sem PHI).
4. Logs sem PHI (remover anamnese/nome/URLs) + teste anti-regressão.
5. Body limit 5mb configurável; `.env.example`; README atualizado.
6. Rodar suíte completa; commit.

## Decisões pendentes de humano (não bloqueiam os marcos atuais)

- Configurar `WEBHOOK_TOKEN`/`ADMIN_NUMBERS`/`DIAG_TOKEN` em produção (Railway)
  e acrescentar `?token=` na URL do webhook no painel UltraMsg.
- Limpeza de logs antigos do Railway que contêm PHI (R-03/R-08).
- Gateway de billing (Stripe vs. Asaas/iugu) — só no Marco 5.
