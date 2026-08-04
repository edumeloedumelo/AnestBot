# STATUS — estado vivo do projeto

> Atualize este arquivo ao fim de cada marco e antes de encerrar qualquer sessão.

**Última atualização:** 04/08/2026 · **Branch:** `claude/anestbot-platform-efo1c0`

## Onde estamos

- [x] Auditoria do repositório e leitura integral do código do bot
- [x] Baseline executado e registrado (`docs/BASELINE.md`) — 76 testes ✅, audit ✅
- [x] Documentação operacional criada (CLAUDE.md, PROMPT-MESTRE, docs/*)
- [x] **Marco 0 — baseline e proteção** ✅ (93 testes verdes; smoke test dos endpoints OK)
- [x] **Marco 1 — integração confiável (outbox/HMAC/idempotência)** ✅ (107 testes verdes)
- [x] **Marco 2 — núcleo SaaS (API, tenants, RBAC, inbox)** ✅ (30 testes de integração verdes em Postgres real)
- [ ] **Marco 3 — prontuário anestésico** ← PRÓXIMO
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

## Marco 2 — entregue

- `packages/database/migrations/001..003`: teams, users (com CRM/MFA),
  memberships, sessions (hash), invites (uso único), whatsapp_links, patients,
  patient_alerts, cases (máquina de estados + unique por correlação),
  case_analyses (imutáveis, versionadas por seq), case_pending_items,
  medical_reviews, overrides, consents, inbox_receipts, outbox_events,
  audit_logs — imutabilidade por TRIGGER (D-014).
- `apps/api` (TypeScript estrito, Express 5, pg, Ajv): auth completo
  (registro→equipe owner, login com mensagem única + rate limit, sessões
  opacas revogáveis, logout-all, MFA TOTP), RBAC com matriz explícita
  (`src/rbac.ts`), convites com expiração/uso único, pareamento chat⇄tenant,
  inbox `/internal/events` (raw body + HMAC 2 segredos + janela 300s + dedup +
  processamento transacional + 409 sem pareamento), pacientes (dedup assistida,
  alertas, trilha de acesso), casos (lista/detalhe com REDAÇÃO clínica p/
  secretaria, pendências, revisão médica com CRM obrigatório, override com
  motivo), dashboard agregado, auditoria append-only, /health /ready, headers
  seguros, CORS allowlist, erro central sem vazamento.
- `scripts/testdb.sh` (Postgres 16 REAL efêmero), `scripts/seed.ts` (sintético,
  recusa banco não-vazio — validado), `.env.example`.
- CI: job da plataforma com service container postgres:16 + typecheck + audit.
- Testes (30, todos em Postgres real): cenários 1–7 do prompt-mestre cobertos —
  tenant A→B (404), secretaria vs. campo clínico (redação comprovada), webhook
  sem/errada/expirada assinatura (401), rotação de segredo, replay/duplicata
  (1 caso só), payload 1MB (413), não pareado (409), imutabilidade por trigger,
  máquina de estados não regride, CRM obrigatório, homônimos não fundidos,
  auditoria sem conteúdo clínico, logs sem PHI.

## Próximo passo imediato

Marco 3 — prontuário anestésico (`apps/api` + migrations):
1. Migration 004: anesthesia_records (pré/intra/pós), anesthesia_events,
   vitals, record_addenda, signatures (hash sha256 do snapshot canônico),
   record_templates versionados.
2. Endpoints: criar registro a partir de caso, rascunho (draft), eventos/vitais,
   assinatura (congela snapshot + hash; registro assinado imutável), adendos.
3. Testes: registro assinado não pode ser alterado (cenário 14), adendo
   rastreável, hash verificável.

## Decisões pendentes de humano (não bloqueiam os marcos atuais)

- Configurar `WEBHOOK_TOKEN`/`ADMIN_NUMBERS`/`DIAG_TOKEN` em produção (Railway)
  e acrescentar `?token=` na URL do webhook no painel UltraMsg.
- Limpeza de logs antigos do Railway que contêm PHI (R-03/R-08).
- Gateway de billing (Stripe vs. Asaas/iugu) — só no Marco 5.
