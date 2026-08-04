# STATUS — estado vivo do projeto

> Atualize este arquivo ao fim de cada marco e antes de encerrar qualquer sessão.

**Última atualização:** 04/08/2026 · **Branch:** `claude/anestbot-platform-efo1c0`

## Onde estamos

- [x] Auditoria do repositório e leitura integral do código do bot
- [x] Baseline executado e registrado (`docs/BASELINE.md`) — 76 testes ✅, audit ✅
- [x] Documentação operacional criada (CLAUDE.md, PROMPT-MESTRE, docs/*)
- [x] **Marco 0 — baseline e proteção** ✅ (93 testes verdes; smoke test dos endpoints OK)
- [ ] **Marco 1 — integração confiável (outbox/HMAC/idempotência)** ← EM ANDAMENTO
- [ ] Marco 2 — núcleo SaaS (monorepo, PostgreSQL, auth, tenants, RBAC)
- [ ] Marco 3 — prontuário anestésico
- [ ] Marco 4 — faturamento
- [ ] Marco 5 — conhecimento e comercial

## Último commit / testes

- Testes bot: `cd anestbot2 && npm test` → **93/93 ✅** (76 preservados + 17 do Marco 0)
- Smoke test real (servidor em porta local): `/health` 200 · `/ready` 200/503 ·
  `/webhook` sem token **401**, token errado **401**, token certo 200 ·
  `/diag` sem token **404**, com token só contadores agregados.

## Marco 0 — entregue

- `anestbot2/src/security.js` (novo): `webhookAuthDecision` (constant-time),
  `readinessCheck`, `diagAuthorized` (fail-closed).
- `anestbot2/src/index.js`: auth no `/webhook` (401), `/ready`, `/diag`,
  body limit 5mb (env), avisos de boot p/ envs de segurança ausentes.
- `anestbot2/src/commands.js`: admin **fail-closed** (`computeIsAdmin`);
  log de anamnese REMOVIDO; nome/cirurgia viram flags.
- `anestbot2/src/format.js` + `triage.js`: logs sem PHI (tamanhos/host apenas).
- `anestbot2/src/store.js`: `diagSnapshot()` só com contadores.
- `anestbot2/.env.example` (novo); README atualizado; `.github/workflows/ci.yml`
  (npm ci + testes + audit + gitleaks; job da plataforma auto-detecta apps/api).
- Testes novos: CASOs 25–28 (auth do webhook, admin fail-closed, readiness,
  diag sem PHI, guardas funcionais e estáticas de log).

## Próximo passo imediato

Marco 1 — integração confiável no bot (`anestbot2/`):
1. `packages/contracts`: envelope de evento + assinatura (espelho JS p/ o bot).
2. `src/events.js`: outbox durável em `STATE_DIR/anestbot2-outbox.json`,
   HMAC-SHA256 (`v1=ts.body`), retry backoff+jitter, dead-letter, no-op sem env.
3. Emissão: `case.received.v1` (fechamento), `case.analysis_started/completed/failed.v1`.
4. Testes: durabilidade, retry, dead-letter, assinatura, replay/idempotência.

## Decisões pendentes de humano (não bloqueiam os marcos atuais)

- Configurar `WEBHOOK_TOKEN`/`ADMIN_NUMBERS`/`DIAG_TOKEN` em produção (Railway)
  e acrescentar `?token=` na URL do webhook no painel UltraMsg.
- Limpeza de logs antigos do Railway que contêm PHI (R-03/R-08).
- Gateway de billing (Stripe vs. Asaas/iugu) — só no Marco 5.
