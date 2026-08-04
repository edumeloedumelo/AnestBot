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
- [x] **Marco 3 — prontuário anestésico** ✅ (39 testes de integração verdes)
- [x] **Marco 4 — faturamento** ✅ (50 testes de integração verdes)
- [~] **Marco 5 — conhecimento e comercial** — biblioteca clínica ENTREGUE
  (56 testes verdes); itens comerciais restantes documentados abaixo
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

## Marco 3 — entregue

- Migration 004: record_templates (versionados por nome — nunca sobrescreve),
  anesthesia_records (pré/intra/pós em jsonb, draft→signed), anesthesia_events
  (drogas/via aérea/eventos/notas com horário), vitals (com CHECKs de faixa),
  signatures (hash sha256 + snapshot canônico, 1 por registro), record_addenda.
  Imutabilidade por TRIGGER: registro assinado bloqueia UPDATE/DELETE próprio e
  INSERT/UPDATE/DELETE de eventos/vitais; assinaturas/adendos append-only.
- `src/canonical.ts`: JSON canônico determinístico (chaves ordenadas) + sha256.
- `src/routes/records.ts`: CRUD de rascunho, eventos, vitais, assinatura
  (exige CRM; congela snapshot na MESMA transação), adendos (só em assinado,
  com CRM), templates, verificação de integridade no GET (recalcula hash).
- RBAC: `record:read/write/sign` — secretaria SEM acesso ao prontuário.
- Nota honesta no código: é registro de autoria com integridade verificável,
  NÃO assinatura eletrônica qualificada ICP-Brasil (etapa futura).
- Testes (9 novos, 39 total): cenário 14 comprovado por API (409) E por
  bypass direto no banco (trigger), hash verificável, adendo não quebra
  verificação, RBAC, isolamento, templates versionados, auditoria sem PHI.

## Marco 4 — entregue

- Migration 005: procedure_imports (versão com checksum sha256 — NUNCA
  embutimos valores TUSS/CBHPM; cada equipe importa a base autorizada),
  procedure_code_versions (imutáveis), insurers, insurer_port_prices
  (CENTAVOS bigint, vigência), billing_entries (memória de cálculo jsonb
  imutável por trigger), billing_entry_items (referência à versão exata do
  código), payment_events (append-only).
- `src/billing/calc.ts`: calculadora PURA — múltiplos 100/70/50 ordenados por
  valor (desempate por código = determinismo), acréscimos percentuais sobre o
  subtotal, arredondamento half-up documentado, memória legível, inteiros
  seguros apenas (lança em float).
- `src/routes/billing.ts`: importação (checksum server-side), busca na versão
  mais recente, convênios/preços, entrada calculada 100% server-side (cliente
  nunca envia preço), eventos com máquina a_faturar→enviado→pago|glosado
  (glosa exige motivo; glosado→enviado = recurso; pago terminal), relatório
  por status/convênio.
- RBAC: `billing:read/write` — secretaria OPERA faturamento; viewer não acessa.
- Testes (11 novos, 50 total): meio-centavo half-up exato, reprodutibilidade
  bit a bit, checksum estável entre reimportações, 422 p/ código fora da base
  e porte sem preço, transições inválidas 409, glosa sem motivo 400, trilha
  completa enviado→glosado→enviado→pago, imutabilidade por trigger, RBAC.

## Marco 5 — biblioteca clínica entregue

- Migration 006: topics (slug único/equipe, institucional × referência externa)
  + topic_versions (autor, aprovador médico com CRM, draft/approved/retired,
  tsvector 'portuguese' + índice GIN). Versão aprovada é IMUTÁVEL por trigger
  (correção = versão nova; anterior vira retired, nunca é apagada).
- `src/routes/topics.ts`: criação (referência externa EXIGE fonte), novas
  versões, aprovação (exige CRM — 403 sem), busca full-text em português só de
  versões aprovadas, aviso "apoio à decisão" em TODA resposta da biblioteca.
- RBAC: `library:read` (todos), `library:write` (owner/admin/anest),
  `library:approve` (owner/anest com CRM).
- Testes (6 novos, 56 total): rascunho invisível na busca, fonte obrigatória,
  aprovação com CRM, v2 não substitui v1 até aprovar, retired preservada,
  imutabilidade por trigger, RBAC, slug duplicado.

## Suítes (estado final desta sessão)

- Bot: `cd anestbot2 && npm test` → **107/107 ✅**
- Plataforma: `cd apps/api && npm test` → **56/56 ✅** (Postgres 16 real efêmero)
- Typecheck: `cd apps/api && npm run typecheck` → ✅ · `npm audit` (ambos) → 0 vulns

## Trabalho restante (Marco 5 comercial + itens transversais)

1. **Assistente IA da biblioteca com citações** (recuperação sobre topics
   aprovados; resposta sem fonte marcada como insuficiente) — seção 16.
2. **Limites de plano no backend** (starter/pro/business por rota) + adaptador
   de billing — gateway PENDENTE DE DECISÃO HUMANA (Stripe × Asaas/iugu).
3. **Onboarding guiado + tenant demo** (seed já existe: `npm run seed`).
4. **Landing page** separada do app; métricas de ativação sem dados clínicos.
5. **apps/web (PWA)** — todo o frontend mobile-first (paleta da seção 18).
6. **PDF verificável do registro** (fonte de verdade já estruturada + hash).
7. **packages/clinical-rules** — regras determinísticas versionadas (seção 6);
   hoje as regras clínicas vivem no prompt versionado (PROMPT_REV) + config.
8. **S3 privado para case_files** (URLs temporárias) — bot hoje não persiste
   mídia após análise; decisão de storage é humana (custo).
9. Rotação automatizada de segredos, backups testados, runbooks (seção 19).

## Decisões pendentes de humano (não bloqueiam revisão desta branch)

- Configurar em produção (Railway): `WEBHOOK_TOKEN`, `ADMIN_NUMBERS`,
  `DIAG_TOKEN` e, quando a plataforma subir, `PLATFORM_EVENTS_URL/SECRET`.
- Acrescentar `?token=` na URL do webhook no painel UltraMsg.
- Limpar retenção de logs antigos do Railway (contêm PHI — R-03/R-08).
- Gateway de billing; provedor S3; hospedagem da plataforma.

## Decisões pendentes de humano (não bloqueiam os marcos atuais)

- Configurar `WEBHOOK_TOKEN`/`ADMIN_NUMBERS`/`DIAG_TOKEN` em produção (Railway)
  e acrescentar `?token=` na URL do webhook no painel UltraMsg.
- Limpeza de logs antigos do Railway que contêm PHI (R-03/R-08).
- Gateway de billing (Stripe vs. Asaas/iugu) — só no Marco 5.
