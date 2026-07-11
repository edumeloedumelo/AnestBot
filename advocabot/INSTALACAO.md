# AdvocaBot — Guia de Instalação Completo

Bot de WhatsApp com IA jurídica multi-agente.
Stack: UltraMsg + Claude (Anthropic) + Railway + Node.js 20

---

## Pré-requisitos

1. Conta no **UltraMsg** (ultramsg.com) — WhatsApp conectado e ativo
2. Conta na **Anthropic** (console.anthropic.com) — API Key com créditos
3. Conta no **Railway** (railway.app) — para hospedagem
4. Conta no **GitHub** — para o deploy automático
5. **Claude Code** instalado localmente (opcional, para editar o código)

---

## Passo 1 — Clonar e preparar o repositório

### Com Claude Code (recomendado):
```bash
# Instale o Claude Code (se não tiver)
npm install -g @anthropic-ai/claude-code

# Clone o repositório
git clone https://github.com/SEU_USUARIO/advocabot.git
cd advocabot

# Abra com Claude Code
claude .
```

### Manualmente:
```bash
git clone https://github.com/SEU_USUARIO/advocabot.git
cd advocabot/advocabot
npm install
```

---

## Passo 2 — Configurar variáveis de ambiente

Crie o arquivo `.env` na pasta `advocabot/`:

```env
# ===== UltraMsg =====
ULTRAMSG_INSTANCE_ID=instance000000
ULTRAMSG_TOKEN=seu_token_aqui

# ===== Anthropic (Claude) =====
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6
ANTHROPIC_MAX_TOKENS=4096
ANTHROPIC_TIMEOUT_MS=300000

# ===== Servidor =====
PORT=3000

# ===== Restrições (opcional) =====
# IDs dos grupos autorizados (ex: 120363012345678901@g.us), separados por vírgula
ALLOWED_CHATS=
# Números admin (5511999999999), separados por vírgula. Vazio = todos são admin.
ADMIN_NUMBERS=

# Prefixo dos comandos
TRIGGER_PREFIX=/
```

---

## Passo 3 — Configurar o UltraMsg

1. Acesse **ultramsg.com** → sua instância
2. Vá em **Settings**
3. Configure:
   - **Webhook URL**: `https://sua-url-railway.up.railway.app/webhook`
   - **Webhook Download Media**: **ON** ← CRÍTICO para PDFs e imagens
   - **Send Delay**: 1-2 segundos (evita ban)
4. Salve e teste a conexão

> ⚠️ **Sem "Webhook Download Media: ON"**, o bot não conseguirá ler PDFs e imagens enviados no grupo.

---

## Passo 4 — Deploy no Railway

### 4.1 — Criar projeto no Railway

1. Acesse **railway.app** → New Project
2. Selecione **Deploy from GitHub repo**
3. Conecte sua conta GitHub e selecione o repositório
4. Railway detecta o `Dockerfile` automaticamente

### 4.2 — Configurar variáveis no Railway

No painel do Railway → seu serviço → **Variables**, adicione:

```
ULTRAMSG_INSTANCE_ID = instance000000
ULTRAMSG_TOKEN       = seu_token_aqui
ANTHROPIC_API_KEY    = sk-ant-...
ANTHROPIC_MODEL      = claude-sonnet-4-6
ANTHROPIC_MAX_TOKENS = 4096
ALLOWED_CHATS        = 120363...@g.us
ADMIN_NUMBERS        = 5511999999999
```

### 4.3 — Configurar volume persistente (IMPORTANTE)

Sem volume, o `state.json` e `media-store.json` são apagados em cada redeploy.

1. Railway → seu serviço → **Volumes**
2. Clique em **Add Volume**
3. Mount Path: `/data`
4. Salve — Railway vai redeploy automaticamente

> O bot já usa `/data` como padrão. Nenhuma variável extra necessária.

### 4.4 — Obter a URL pública

1. Railway → seu serviço → **Settings** → **Domains**
2. Clique em **Generate Domain** (algo como `advocabot.up.railway.app`)
3. Cole essa URL no UltraMsg como Webhook URL: `https://advocabot.up.railway.app/webhook`

---

## Passo 5 — Testar o bot

No WhatsApp, no grupo onde o bot está ativo:

```
/ajuda
```

Deve aparecer o menu completo. Depois teste um caso:

```
start case

Fui demitido sem justa causa hoje após 5 anos na empresa em São Paulo.
Não recebi aviso prévio, FGTS ou multa. Tenho contrato assinado.

finish case
```

Ao receber `finish case`, a análise dispara automaticamente. O bot vai:
1. 🔍 Classificar o caso → Trabalhista
2. ⚖️ Rodar o especialista trabalhista
3. 👨‍⚖️ CEO sintetizar o parecer final

---

## Passo 6 — Personalizar o bot

### Adicionar instruções ao CEO:
```
/setprompt Nosso escritório é especializado em direito trabalhista em São Paulo. Sempre mencione o prazo bienal de prescrição e a possibilidade de tutela de urgência para casos de salário em atraso.
```

### Ativar/desativar áreas:
```
/desativararea previdenciario
/ativararea penal
/areas
```

### Ver status do bot:
```
/status
```

---

## Protocolo para os clientes/secretária

Para que o bot analise corretamente, cada caso deve seguir:

```
start case

[descrição do caso — seja detalhado]

[Envie os documentos: contratos, notificações, prints, PDFs]

finish case
```

Ao enviar `finish case`, a análise começa automaticamente — não é preciso
nenhum comando extra.

> Protocolo legado ainda aceito: abrir com ⚖️/📋, encerrar com ❌❌❌❌ e
> rodar `/analisar` manualmente.

O bot atua **somente em grupos** por padrão (`GROUPS_ONLY=true`). Para
permitir conversas individuais, defina `GROUPS_ONLY=false` nas variáveis.

---

## Custo estimado por caso

| Etapa | Tokens (estimativa) | Custo (claude-sonnet-4-6) |
|-------|---------------------|--------------------------|
| Classificador | ~500 in + 100 out | ~$0,001 |
| 2-3 Especialistas | ~4.000 in + 5.000 out | ~$0,09 |
| CEO | ~8.000 in + 3.000 out | ~$0,07 |
| **Total por caso** | | **~$0,16** |

Preços aproximados. Consulte console.anthropic.com para valores atuais.

---

## Solução de problemas

### Bot não responde
- Verifique se o Webhook URL está correto no UltraMsg
- Verifique logs no Railway → seu serviço → **Logs**
- Confirme que `ANTHROPIC_API_KEY` tem créditos

### "0 documento(s)" na análise
- Ative "Webhook Download Media: ON" no UltraMsg
- Se os arquivos foram enviados antes do último redeploy, reenvie-os

### Análise demorada
- Normal: o sistema roda múltiplos agentes em paralelo
- Pode levar 30-90 segundos dependendo do número de especialistas
- Aumente `ANTHROPIC_TIMEOUT_MS` se necessário (padrão: 300000 = 5 min)

### Resetar posição de leitura
```
/resetar
```
Útil quando o bot para de encontrar casos novos.

---

## Arquitetura do sistema

```
WhatsApp → UltraMsg Webhook → Railway (Node.js)
                                    ↓
                              router.js (recebe)
                                    ↓
                              commands.js (/analisar)
                                    ↓
                              fetcher.js (GET mensagens)
                                    ↓
                              parser.js (separa casos)
                                    ↓
                         orchestrator.js (multi-agente)
                          ┌──────┼────────┐
                    classifier  specialists  CEO
                          └──────┼────────┘
                                 ↓
                          anthropic.js (Claude API)
                                 ↓
                          format.js → WhatsApp
```

---

## Suporte

- Logs: Railway → seu serviço → Logs
- Variáveis: Railway → seu serviço → Variables
- UltraMsg: ultramsg.com → sua instância → Settings
- Anthropic: console.anthropic.com → Usage
