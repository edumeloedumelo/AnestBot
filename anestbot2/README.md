# ANESTBOT 2.0

Bot de triagem pré-anestésica no WhatsApp — **arquitetura webhook-first**.
UltraMsg (WhatsApp) + Claude (Anthropic). Node.js + Express, deploy no Railway.

## Por que 2.0 (o que mudou de verdade)

A 1.0 buscava as mensagens pelo endpoint `GET /chats/messages` da UltraMsg na hora
do `/analisar`. Esse endpoint **trunca o texto de mensagens longas** (o card de
anamnese completo), então o "Procedimento:" nunca chegava ao Claude — a causa raiz
de todos os bugs de "cirurgia não informada".

**A 2.0 é webhook-first:** toda mensagem (texto E mídia) é gravada em tempo real,
com o texto **completo**, num store persistente por grupo (`/data`). O `/analisar`
lê **só** desse store — nunca mais depende do GET. Isso elimina de vez o
truncamento, o problema de id entre webhook/GET, e a contaminação entre casos.

## Como um caso é enviado

```
xxxx                          ← abre o caso (sozinho OU colado ao card)
[ficha da anamnese + exames]  ← texto e PDFs/fotos
❌❌❌❌                        ← fecha o caso (sozinho OU colado ao conteúdo)
/analisar                     ← dispara a triagem
```

Só o conteúdo ENTRE `xxxx` e `❌❌❌❌` é avaliado. Os marcadores podem estar
sozinhos numa mensagem ou colados ao conteúdo — ambos funcionam.

## Deploy (passo a passo)

### 1. Repositório GitHub
Crie um repositório vazio (ex.: `ANESTBOT.2.0`) e suba este diretório nele.

### 2. UltraMsg
- Crie/uma instância nova em https://ultramsg.com e conecte o número do WhatsApp.
- Anote `Instance ID` e `Token`.
- Em **Settings → Webhook**: ligue o webhook, aponte para
  `https://SEU-APP.up.railway.app/webhook`, e **ative "Webhook On Received"** e
  **"Webhook On Message Create"** (para mensagens do próprio número) e
  **"Webhook Download Media: ON"** (obrigatório para os exames chegarem com URL).

### 3. Railway
- Novo projeto → Deploy from GitHub → selecione o repositório.
- **Settings → Root Directory:** deixe vazio se o repo tiver estes arquivos na
  raiz (ou aponte para a subpasta se você subiu dentro de outra).
- **Volumes:** adicione um volume no mount path **`/data`** (persistência).
- **Variables:**
  - `ULTRAMSG_INSTANCE_ID` = seu instance id
  - `ULTRAMSG_TOKEN` = seu token
  - `ANTHROPIC_API_KEY` = sua chave da Anthropic
  - `STATE_DIR` = `/data`
  - **`ADMIN_NUMBERS`** = números admin separados por vírgula. ⚠️ **Configure em
    produção**: se ficar vazio, QUALQUER membro do grupo pode rodar comandos de
    admin (`/resetartudo`, `/setprompt`, `/addcirurgia` etc.).
  - (opcional) `ALLOWED_CHATS` = ids de grupos permitidos (vazio = todos)
  - (opcional) `ANTHROPIC_MODEL` (padrão `claude-sonnet-4-6`)
- O `railway.json` já define builder Dockerfile, healthcheck `/health` e
  `watchPatterns: ["**"]` (todo push dispara deploy).

### 4. Verificação
Nos logs do primeiro boot deve aparecer:
```
🤖 ANESTBOT 2.0 ouvindo na porta 3000
✅ Volume persistente OK em /data      (a partir do 2º deploy)
```
Ao enviar uma ficha, deve aparecer `[webhook] texto gravado ... len=NNNN` com o
tamanho completo do card. No `/analisar`, `[analisar] ... cirurgia="..."`.

## Comandos

`/analisar` · `/status` · `/cirurgias` · `/limites` · `/prompt` · `/resetar [N]` ·
`/ajuda` — e (admin) `/addcirurgia` · `/delcirurgia` · `/addlimite` · `/dellimite` ·
`/setprompt` · `/limparprompt` · `/resetartudo`.

### /resetar — o que ele faz (novo na 2.0)

1. **Reabre APENAS o último caso** (ou os últimos N com `/resetar N`) — os casos
   antigos NUNCA são reanalisados.
2. **Dispara a verificação automática de erros**: varre o estado do bot
   (histórico, dedup, config, volume, API), **corrige sozinho** o que for
   corrigível e **comunica cada correção** no grupo.
3. **Reanalisa o caso reaberto automaticamente** — não precisa mandar
   `/analisar` de novo.

### Comandos do próprio número conectado

O número conectado à UltraMsg também pode enviar comandos (evento
`message_create`). Para que ele use comandos de **admin**, inclua-o em
`ADMIN_NUMBERS`.

## Testes

```
npm test
```

## Estrutura

```
src/
  index.js     — servidor Express + webhook + health
  webhook.js   — normaliza payload UltraMsg → store; dispara comandos
  store.js     — store persistente por grupo (mensagens + dedup + casos)
  parser.js    — divide em casos (xxxx/❌❌❌❌); extrai nome/cirurgia
  commands.js  — /analisar e demais comandos
  triage.js    — monta contexto + mídia e chama o Claude
  media.js     — download + sniff de tipo (corrige lixo inicial) + compressão PDF
  anthropic.js — API Claude
  prompt.js    — system prompt clínico
  format.js    — limpa a saída (remove preâmbulo)
  ultramsg.js  — envio de texto
  config.js    — cirurgias/limites/prompt (persistente, com merge)
config.json    — molde de cirurgias e limites
```

⚠️ Ferramenta de apoio à decisão. Não substitui avaliação médica presencial.
