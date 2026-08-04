# ARCHITECTURE — ANESTBOT Platform

Atualizado: 04/08/2026. Decisões formais em `docs/DECISIONS.md`.

## Visão

```
WhatsApp (grupo da equipe)
   │  UltraMsg webhook (?token=WEBHOOK_TOKEN)
   ▼
┌──────────────────────────────┐      eventos assinados (HMAC, outbox→inbox)
│ anestbot2/  (bot, produção)  │ ───────────────────────────────┐
│ Express + store JSON (/data) │                                ▼
│ triagem via Claude API       │                    ┌──────────────────────────┐
└──────────────────────────────┘                    │ apps/api  (plataforma)   │
                                                    │ TypeScript + PostgreSQL  │
        ┌───────────────────────────────────────────│ auth·tenants·RBAC·casos  │
        ▼                                           │ auditoria append-only    │
┌──────────────────┐                                └──────────────────────────┘
│ apps/web (PWA)   │  ← mobile-first, pt-BR, offline p/ tabelas e rascunhos
└──────────────────┘
```

Princípio: o WhatsApp continua sendo a porta de entrada; o bot de produção não
é reescrito — é **endurecido** e passa a **publicar eventos**. A plataforma é o
cérebro e o cofre (fonte transacional em PostgreSQL).

## Componentes

### `anestbot2/` — bot (produção, preservado)
- Node 20 + Express, ESM, sem framework de teste (runner próprio).
- Estado: `anestbot2-store.json` + `config.json` em `STATE_DIR` (volume Railway
  `/data`), escrita atômica. **1 réplica.**
- Endurecimento (Marco 0): `WEBHOOK_TOKEN` (401 sem token válido, constant-time),
  admin fail-closed, `/ready`, `/diag` protegido por `DIAG_TOKEN` (404 sem
  configuração), body limit 5mb, logs sem PHI.
- Integração (Marco 1): outbox durável em `STATE_DIR/anestbot2-outbox.json`;
  eventos `case.received.v1`, `case.analysis_started.v1`,
  `case.analysis_completed.v1`, `case.analysis_failed.v1` entregues por POST em
  `PLATFORM_EVENTS_URL` com envelope assinado; retry backoff+jitter;
  dead-letter; desligado por padrão (sem env ⇒ no-op).

### `packages/contracts` — contratos compartilhados
- Envelope de evento (JSON Schema): `event_id` (UUID), `event_type` versionado,
  `schema_version`, `occurred_at` (UTC ISO), `tenant_hint` (chat pareado),
  `source`, `correlation_id`, `payload`, chave de idempotência = `event_id`.
- Assinatura HTTP: `X-Anestbot-Timestamp` (epoch s) e `X-Anestbot-Signature`
  (`v1=` + HMAC-SHA256(`timestamp` + "." + corpo bruto)). Janela anti-replay de
  5 minutos + inbox idempotente no receptor.

### `apps/api` — plataforma (TypeScript estrito)
- Express + `pg`; validação Ajv (JSON Schema); sessões opacas com hash em banco.
- Multi-tenant: TODA consulta escopada por `team_id` derivado da sessão — nunca
  do cliente. Acesso negado falha fechado (404/403 sem vazamento).
- RBAC: papéis `owner`, `admin`, `anesthesiologist`, `secretary`, `viewer` com
  matriz explícita testada; secretaria sem acesso a campos clínicos sensíveis.
- Inbox idempotente (`inbox_receipts` com unique por `event_id`) + verificação
  HMAC (2 segredos ativos p/ rotação) + janela de timestamp.
- Auditoria: `audit_logs` append-only (sem UPDATE/DELETE — revogados no schema).
- Logs estruturados sem PHI (ids técnicos e contagens, nunca conteúdo clínico).

### `packages/database`
- Migrations SQL puras, numeradas, com runner mínimo auditável
  (`schema_migrations` com checksum). Seeds exclusivamente sintéticos.
- Datas em UTC (`timestamptz`); dinheiro em centavos (`bigint`).

### `apps/web` — PWA (marcos posteriores)
- Mobile-first, pt-BR, paleta marfim `#EEE7DA` / verde profundo `#23483F–#294F45` /
  realce `#58776F` / grafite `#202124` (seção 18 do prompt-mestre).

## Fluxo de eventos (Marco 1)

1. `❌❌❌❌` fecha um caso ⇒ bot enfileira `case.received.v1` no outbox (durável
   ANTES de tentar entregar).
2. `/analisar` ⇒ `case.analysis_started.v1`; ao fim, `case.analysis_completed.v1`
   (parecer completo + metadados de arquivos vistos/ausentes/degradados) ou
   `case.analysis_failed.v1`.
3. Worker do outbox entrega em ordem com retry (backoff exponencial + jitter,
   teto configurável); após `OUTBOX_MAX_ATTEMPTS`, evento vai à dead-letter
   (visível no `/diag`; replay manual por comando administrativo).
4. Receptor valida assinatura+timestamp, grava em `inbox_receipts`
   (unique `event_id` ⇒ duplicata é 200 sem reprocessar), processa em transação.

**Critério de resiliência:** API fora por 30 min ⇒ nenhum evento perdido;
religada, cada evento é processado exatamente uma vez (garantido pelo unique).

## Registros e assinaturas (Marco 3, planejado)

- Registro anestésico estruturado é a fonte de verdade; PDF é representação.
- Assinar ⇒ congela snapshot canônico + `sha256` gravado em `signatures`;
  qualquer correção posterior é `record_addenda` vinculado, nunca UPDATE.
- Hash verificável no PDF (código de verificação).

## Padrões transversais

- TypeScript `strict` em todo código novo; JS existente do bot não migra por ora.
- Erros: fail-closed em autorização; fail-safe (nunca derrubar o processo) em I/O.
- Sem soft-delete indiscriminado: exclusões modeladas caso a caso (LGPD:
  exportação/anonimização por rotina dedicada, não DELETE ad-hoc).
- Nenhuma dependência nova sem justificativa em DECISIONS.md.
