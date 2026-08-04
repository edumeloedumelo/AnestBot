# STATUS — estado vivo do projeto

> Atualize este arquivo ao fim de cada marco e antes de encerrar qualquer sessão.

**Última atualização:** 04/08/2026 · **Branch:** `claude/anestbot-platform-efo1c0`

## Onde estamos

- [x] Auditoria do repositório e leitura integral do código do bot
- [x] Baseline executado e registrado (`docs/BASELINE.md`) — 76 testes ✅, audit ✅
- [x] Documentação operacional criada (CLAUDE.md, PROMPT-MESTRE, docs/*)
- [x] **Marco 0 — baseline e proteção** ✅ (93 testes verdes; smoke test dos endpoints OK)
- [x] **Marco 1 — integração confiável (outbox/HMAC/idempotência)** ✅ (107 testes verdes)
- [ ] **Marco 2 — núcleo SaaS (API, tenants, RBAC, inbox)** ← EM ANDAMENTO
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

## Marco 1 — entregue

- `packages/contracts/`: README do contrato + `event-envelope.schema.json`
  (envelope, assinatura `v1=HMAC-SHA256(secret, ts.corpo)`, regras do receptor:
  janela 300s, dedup por `event_id`, 413 acima de 1MB).
- `anestbot2/src/events.js` (novo): outbox durável em
  `STATE_DIR/anestbot2-outbox.json` (atômico), FIFO, retry backoff exponencial
  (5s→10min) + jitter ≤30%, dead-letter (maxAttempts ou 4xx permanente), replay
  manual (`/fila reenviar`, mesmos event_id), pump com `unref()`, no-op sem env.
- Emissões: `case.received.v1` (webhook, fechamento real), `case.analysis_started/
  completed/failed.v1` (/analisar) — completed carrega parecer, anamnese, files
  vistos/ausentes/descartados/degradados, modelo e `PROMPT_REV` (rastreabilidade).
- `runTriage` agora retorna `files` (retrato fiel do que a IA viu).
- Testes CASOs 29–33: envelope/HMAC, veredicto de entrega, backoff, no-op,
  **aceite** (API fora → 0 perdidos; religada → ordem + exatamente uma vez;
  restart no meio → fila sobrevive), dead-letter/replay, timeout de rede,
  snapshot sem PHI. Suíte: **107/107 ✅**.

## Próximo passo imediato

Marco 2 — núcleo SaaS (`apps/api` + `packages/database`):
1. Migrations PostgreSQL: teams, users, memberships, sessions, invites,
   whatsapp_links, patients, cases, case_files, case_analyses,
   case_pending_items, medical_reviews, overrides, audit_logs (append-only),
   inbox_receipts, outbox_events, consents.
2. API TypeScript estrito: auth (registro/login/sessões revogáveis), RBAC,
   inbox `/internal/events` (HMAC + timestamp + dedup), casos/pacientes,
   auditoria, dashboard mínimo.
3. Testes: isolamento de tenant, RBAC, webhook sem assinatura/expirado/replay,
   evento duplicado, secretaria vs. campo restrito.

## Decisões pendentes de humano (não bloqueiam os marcos atuais)

- Configurar `WEBHOOK_TOKEN`/`ADMIN_NUMBERS`/`DIAG_TOKEN` em produção (Railway)
  e acrescentar `?token=` na URL do webhook no painel UltraMsg.
- Limpeza de logs antigos do Railway que contêm PHI (R-03/R-08).
- Gateway de billing (Stripe vs. Asaas/iugu) — só no Marco 5.
