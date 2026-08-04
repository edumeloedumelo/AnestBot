# DECISIONS — registro de decisões (ADR curto)

Formato: `D-NNN · data · decisão · motivo · alternativas · reversibilidade`.

---

## D-001 · 04/08/2026 · Endurecimento retrocompatível do bot (fail-safe com aviso)

**Decisão:** As proteções novas do bot (`WEBHOOK_TOKEN`, admin fail-closed,
limite de payload) são ativadas por variável de ambiente. Sem a variável, o bot
mantém o comportamento atual **com aviso alto no boot e no log**, para que um
deploy desta branch nunca derrube a produção que ainda não configurou as envs.
Exceção: admin fail-closed é aplicado SEM env nova (ver D-002) por ser a brecha
mais grave explorável por membros do grupo.

**Motivo:** o prompt-mestre exige simultaneamente "webhook sem autenticação
bloqueado" e "compatibilidade com o deploy atual do Railway". A conciliação é:
enforcement estrito quando configurado; modo de compatibilidade barulhento
quando não. O README e o `.env.example` passam a instruir a configuração.

**Reversível:** sim (remover env volta ao comportamento anterior).

## D-002 · 04/08/2026 · Admin fail-closed: `ADMIN_NUMBERS` vazio ⇒ só `fromMe` é admin

**Decisão:** com `ADMIN_NUMBERS` vazio, apenas o número conectado à UltraMsg
(`fromMe`) é admin — antes, TODOS os membros eram. Não há como o grupo ficar sem
administração (o dono da instância sempre pode operar), então o fail-closed não
tem cenário de bloqueio total.

**Motivo:** exigência explícita do Marco 0 ("administração fail-closed");
`/resetartudo` e `/setprompt` nas mãos de qualquer membro é risco clínico
(injeção de instruções no prompt) e operacional (perda de estado).

**Alternativa rejeitada:** manter fail-open com aviso — contraria o prompt-mestre.

**Reversível:** sim (configurar `ADMIN_NUMBERS` devolve acesso a quem precisar).

## D-003 · 04/08/2026 · Autenticação do webhook por token na URL (`WEBHOOK_TOKEN`)

**Decisão:** o UltraMsg não assina webhooks (sem HMAC nativo). A autenticação é
por segredo compartilhado na URL: configura-se o webhook do UltraMsg como
`https://app/webhook?token=SEGREDO` e o bot valida com comparação constant-time.
Sem `WEBHOOK_TOKEN` configurado: modo compatibilidade (aceita e avisa) — D-001.
Com token configurado: requisição sem/errada recebe **401 e não é processada**.

**Motivo:** é o mecanismo mais forte que o provedor suporta; bloqueia payloads
forjados (inclusive `fromMe: true` falso, que daria admin).

**Reversível:** sim.

## D-004 · 04/08/2026 · Logs sem PHI no bot

**Decisão:** remover/reduzir logs que continham conteúdo clínico: anamnese
(`[analisar] TEXTOS:` — removido), nome do paciente (substituído por
comprimento/flag), preâmbulo do laudo (só tamanho), URLs de mídia (só host).
Teste automatizado garante que os módulos não logam os campos proibidos.

**Motivo:** seção 5.3/5.19/5.20 do prompt-mestre; logs do Railway não são
enclave clínico.

**Custo aceito:** depuração de produção fica um pouco menos direta (compensada
pelos metadados: contagens, tamanhos, ids técnicos).

## D-005 · 04/08/2026 · Limite do body parser por env (`WEBHOOK_BODY_LIMIT`, default 5mb)

**Decisão:** reduzir `express.json` de 60mb para 5mb por padrão, configurável.
Payload normal do UltraMsg (com "Webhook Download Media: ON", obrigatório na
instalação documentada) contém URL de mídia, não base64 — poucos KB.

**Motivo:** 60mb sem autenticação era vetor de abuso de memória. 5mb mantém
folga ampla para qualquer card de anamnese (500KB de teto de anamnese no triage).

**Reversível:** sim (env).

## D-006 · 04/08/2026 · `/ready` (readiness) e `/diag` (diagnóstico protegido)

**Decisão:** `/health` permanece liveness pura (sempre 200 com processo vivo).
Novo `/ready` responde 200 só com STATE_DIR gravável + envs essenciais presentes
(503 caso contrário). Novo `/diag` exige `DIAG_TOKEN` (sem token configurado ⇒
404 — fail-closed) e retorna SOMENTE metadados sem PHI: uptime, nº de chats,
contadores de mensagens/fila, config counts, flags de env.

**Motivo:** seção 19 do prompt-mestre (runtime). Fail-closed no diagnóstico
porque ele expõe topologia interna.

## D-007 · 04/08/2026 · Outbox do bot em arquivo no volume persistente (Marco 1)

**Decisão:** o outbox de eventos do bot é um arquivo JSON no volume `/data`
(mesmo mecanismo de persistência do store, escrita atômica), com entrega HTTP
assinada (HMAC-SHA256, timestamp, event_id UUID, chave de idempotência), retry
com backoff exponencial + jitter e dead-letter após limite configurável.
Sem `PLATFORM_EVENTS_URL`/`PLATFORM_EVENTS_SECRET` configurados, o outbox fica
**desligado** (no-op, sem acúmulo em disco).

**Motivo:** o bot não tem banco; o volume é a única durabilidade disponível e
já é confiável em produção. Postgres entra no receptor (Marco 2), não no bot —
o bot permanece com dependências mínimas.

**Alternativa rejeitada:** dar Postgres ao bot — acopla a produção estável a
infra nova, contra a seção 3 do prompt-mestre.

## D-008 · 04/08/2026 · Runner de testes: manter o padrão do repositório (sem framework)

**Decisão:** os testes novos do bot seguem o runner próprio (`test/run.mjs`,
asserções diretas), sem adicionar Jest/Vitest ao bot. A plataforma (TypeScript,
Marco 2+) usa `node:test` nativo, sem dependência de framework de teste.

**Motivo:** menor mudança coerente; nenhuma dependência sem justificativa
(seção 22); o runner atual cobre bem o estilo dos testes do bot.

## D-009 · 04/08/2026 · Plataforma: Node 20+ TypeScript estrito, sem framework pesado no Marco 1–2 inicial

**Decisão:** `apps/api` nasce com TypeScript `strict`, Express (já dominado no
repo) e `pg` para PostgreSQL; validação de schema com JSON Schema (Ajv).
Migrations em SQL puro versionado (`packages/database/migrations`), aplicadas
por um runner mínimo auditável.

**Motivo:** tecnologias maduras, superfícies pequenas, mesmas primitivas já em
produção no repo. NestJS/ORMs podem entrar depois por ADR se a complexidade
justificar.

## D-010 · 04/08/2026 · Versões da plataforma: Express 5, TypeScript ~5.9, Ajv 8, pg 8

**Decisão:** Express **5.2** (rejeições em handlers async propagam ao error
handler central — elimina classe inteira de "request pendurado"); TypeScript
**~5.9.3** (linha madura; TS 7/tsgo recém saiu do RC — cedo demais para
produção clínica); `pg` 8 e Ajv 8 (padrões de fato). O bot permanece em
Express 4 (produção intocada).

## D-011 · 04/08/2026 · Autenticação da API: Bearer tokens opacos, sem cookies (por ora)

**Decisão:** sessões são tokens opacos (32 bytes aleatórios) com **apenas o
sha256 armazenado**, expiração de 14 dias e revogação (logout/logout-all).
Transporte por `Authorization: Bearer` — sem cookies, não há superfície de
CSRF. Senhas com scrypt (N=16384, r=8, p=1, salt 16B, verify constant-time).
MFA TOTP (RFC 6238) implementado em node:crypto, sem dependência.
Quando o PWA precisar de cookie httpOnly, entra por ADR com CSRF token.

## D-012 · 04/08/2026 · Testes de integração com PostgreSQL REAL efêmero

**Decisão:** `apps/api/scripts/testdb.sh` sobe um cluster PostgreSQL 16 real
descartável (initdb + pg_ctl em socket unix; como root usa o usuário dedicado
`pguser`) e roda a suíte com `node:test`. No CI, um service container
postgres:16 via `DATABASE_URL_TEST`. Sem emuladores (pg-mem descartado): os
triggers de imutabilidade e o comportamento real de constraints SÃO o que os
testes provam. (Supera o risco R-12, que previa fallback para pg-mem.)

## D-013 · 04/08/2026 · Evento de chat não pareado responde 409 (dead-letter + replay)

**Decisão:** o inbox rejeita com **409** evento de `chat_ref` sem pareamento.
No emissor, 4xx ≠ 408/429 é erro permanente ⇒ dead-letter imediata. O fluxo
operacional é: parear o grupo no app → `/fila reenviar` no bot → eventos
reprocessam (mesmos `event_id`, dedup no receptor).

**Alternativa rejeitada:** aceitar e guardar "órfão" sem tenant — criaria
depósito de dados clínicos sem dono/escopo (risco LGPD) e mascararia erro de
configuração.

## D-014 · 04/08/2026 · Imutabilidade por TRIGGER no banco

**Decisão:** `audit_logs`, `medical_reviews`, `overrides` e `case_analyses`
têm trigger `forbid_mutation` que bloqueia UPDATE/DELETE no próprio Postgres.
Reanálise = nova linha com `seq` incrementado; correção de revisão = nova
revisão. Consequência aceita: DELETE de caso com análise falha (bloqueado) —
apagamento LGPD será rotina dedicada com autorização (marco posterior).
