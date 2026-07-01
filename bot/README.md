# AnestGuide — Bot de WhatsApp (Triagem Pré-Anestésica)

Bot que roda num grupo de WhatsApp: recebe fotos/PDFs de exames + dados da paciente,
analisa com a **API da Anthropic (Claude)** seguindo um protocolo de triagem
pré-anestésica e responde no próprio grupo de forma tabelada (texto monoespaçado).
As cirurgias, exames obrigatórios, limites de referência e instruções extras são
**editáveis por comandos no próprio WhatsApp**.

**Multi-tenant**: cada clínica tem sua própria instância UltraMsg (número
próprio) e sua própria configuração — tudo vem do Postgres compartilhado com o
`backend/` (tenants, planos, cobrança), não mais de `config.json`/env var global.

Stack: **Node.js + Express + Postgres + UltraMsg + Claude**.

---

## 1. Instalação

```bash
cd bot
npm install
cp .env.example .env   # preencha as variáveis
npm start
```

## 2. Variáveis de ambiente (`.env`)

| Variável | O que é |
|---|---|
| `DATABASE_URL` | Postgres — o **mesmo banco** usado pelo `backend/` |
| `TOKEN_ENCRYPTION_KEY` | **idêntica** à do `backend/` — decifra o token da UltraMsg salvo por lá |
| `ANTHROPIC_API_KEY` | Chave da API Anthropic (`sk-ant-...`) |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` (padrão), `claude-opus-4-8` (mais preciso) ou `claude-haiku-4-5` |
| `TRIGGER_PREFIX` | prefixo dos comandos (padrão `/`) |
| `PORT` | Porta do servidor (padrão 3000) |

Não existe mais `ULTRAMSG_INSTANCE_ID`/`ULTRAMSG_TOKEN`/`ALLOWED_CHATS`/
`ADMIN_NUMBERS` como env var global — isso agora é por tenant, vem do banco
(`whatsapp_numbers`, `tenant_configs.admin_numbers`).

## 3. Provisionamento de um cliente novo

Ver aviso em `backend/src/routes/provisioning.js`: hoje a criação da instância
UltraMsg é manual (sem confirmação de API pública de criação automática). Fluxo:

1. Dono cria a instância no painel da UltraMsg.
2. Configura o webhook dessa instância pra `https://SEU_DOMINIO/webhook/:tenantId`
   (o `:tenantId` é o UUID do tenant no banco).
3. Dono chama `POST /admin/tenants/:tenantId/attach-instance` no `backend/` com
   `{ instanceId, token }` — isso salva a conexão e libera o QR de pareamento
   (`GET /onboarding/qr` no backend, endpoint ainda não verificado contra a API
   real da UltraMsg).
4. Cliente escaneia o QR; o worker de Conexão do backend detecta e ativa o tenant.

## 4. Como usar no grupo (depois de ativo)

1. Mandem as **fotos/PDFs dos exames** no grupo (o bot vai bufferizando em
   memória, por tenant+chat).
2. Rodem a análise:
   ```
   /analisar
   ```
   (separem cada paciente com `❌❌❌❌` se houver mais de um no mesmo lote)
3. O bot responde com o relatório técnico tabelado + bloco-resumo, um por paciente.

## 5. Comandos

**Gerais**
- `/analisar` ou `/triagem` — analisa os casos no buffer
- `/status` — mostra o que está no buffer e a cota do mês
- `/resetar`, `/reset` ou `/limpar` — limpa o buffer (admin)
- `/cirurgias` — lista cirurgias e exames exigidos
- `/limites` — lista valores de referência
- `/prompt` — mostra instruções extras ativas
- `/ajuda` — ajuda

**Edição (admin — definido em `tenant_configs.admin_numbers`)**
- `/addcirurgia chave; Nome; exame1, exame2` — cria/atualiza cirurgia
- `/delcirurgia chave`
- `/addlimite Exame; descrição; unidade; obs` — cria/atualiza limite
- `/dellimite Exame`
- `/setprompt texto` — adiciona instruções ao protocolo
- `/limparprompt`

## 6. Arquitetura

```
WhatsApp (grupo da clínica, número dedicado por tenant)
   │  mensagem/mídia
   ▼
UltraMsg ──webhook──▶ Express /webhook/:tenantId (index.js)
                          │
                          ▼
                     router.js ── resolve tenant (tenant.js) + dedupe (idempotency.js)
                          │  comando? ──▶ commands.js ──▶ quota.js / audit.js
                          │  mídia/texto (serializado por chat, sessions.js)
                          ▼
                     sessions.js (buffer em memória)
                          │ /analisar consome o buffer
                          ▼
                     triage.js ── system prompt (prompt.js + config.js/Postgres)
                          │ mídias em base64 (ultramsg.js)
                          ▼
                     Claude (anthropic.js) ── retry em erro transiente
                          │
                     format.js ──▶ sendText (ultramsg.js) ──▶ grupo
```

Config, cota e log de auditoria vêm do Postgres compartilhado com `backend/`
(mesma `DATABASE_URL`) — não há mais estado em arquivo local (`config.json`,
`state.json`, `media-store.json` foram removidos).

## 7. Aviso

Sugestão acadêmica de apoio à decisão — a conduta final é sempre do
anestesiologista responsável, o bot nunca a substitui.

**Retenção de dados**: nenhum conteúdo clínico é gravado em disco ou banco —
buffer de exames fica só em memória (RAM do processo), com TTL de 6h. O único
registro persistente é um log mínimo não-identificável (`triage_audit_log`:
timestamp, tenant, status final 🟢/🟡/🔴 — sem nome de paciente, sem exame).
Ainda assim, dados de pacientes trafegam pela UltraMsg e pela Anthropic — garanta
base legal (LGPD) com esses subprocessadores.
