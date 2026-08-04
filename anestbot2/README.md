# ANESTBOT

Bot de triagem pré-anestésica no WhatsApp — **arquitetura webhook-first**.
UltraMsg (WhatsApp) + Claude (Anthropic). Node.js + Express, deploy no Railway.

## Por que webhook-first (o que mudou da 1.0)

A 1.0 buscava as mensagens pelo endpoint `GET /chats/messages` da UltraMsg na hora
do `/analisar`. Esse endpoint **trunca o texto de mensagens longas** (o card de
anamnese completo), então o "Procedimento:" nunca chegava ao Claude — a causa raiz
de todos os bugs de "cirurgia não informada".

**O ANESTBOT é webhook-first:** toda mensagem (texto E mídia) é gravada em tempo
real, com o texto **completo**, num store persistente por grupo (`/data`). O
`/analisar` lê **só** desse store — nunca depende do GET. Isso elimina de vez o
truncamento, o problema de id entre webhook/GET, e a contaminação entre casos.

## Como um caso é enviado

```
xxxx                          ← abre o caso (sozinho OU colado ao card)
[ficha da anamnese + exames]  ← texto e PDFs/fotos
❌❌❌❌                        ← fecha o caso (sozinho OU colado ao conteúdo)
/analisar                     ← dispara a triagem
```

**Regra absoluta do portão:** o webhook só armazena o conteúdo **entre `xxxx` e
`❌❌❌❌`**. Comandos funcionam em grupos e em conversas privadas, mas nada fora
do portão é lido nem gravado. Os marcadores podem estar sozinhos numa mensagem ou
colados ao conteúdo — ambos funcionam.

## Defesas de produção (aprendidas em incidentes reais)

- **Mídia atrasada (UltraMsg):** o webhook de mídia chega **minutos** depois do
  webhook de texto (a UltraMsg precisa hospedar o arquivo antes). O roteamento de
  mídia órfã usa o **timestamp de envio no WhatsApp**, nunca a ordem de chegada:
  mídia enviada antes do `❌❌❌❌` entra no caso silenciosamente (`inside`); logo
  após o fechamento entra no caso fechado com um único aviso `📎` (com throttle);
  e mídia realmente órfã só é adotada pelo próximo `xxxx` dentro de uma janela
  estreita — **exame nenhum cai no paciente errado**.
- **Anti-travamento:** timeout em todo I/O (download 60s, ghostscript 60s,
  conversão de imagem 30s, envio 20s, Claude 120s, ping 15s) + **watchdog por
  caso** com teto dinâmico proporcional ao nº de exames. O lock do `/analisar`
  nunca fica preso.
- **Orçamento de payload (anti-413):** casos com dezenas de exames respeitam um
  orçamento de 24 MB por requisição — recompressão agressiva dos maiores
  arquivos e, em último caso, descarte com aviso explícito ("reenviar sozinho").
  Downloads em pool de 3 com preservação de ordem; retry cumulativo em erros de
  tamanho.
- **Segurança clínica:** compressão agressiva pode corromper dígitos — todo
  arquivo degradado é listado no contexto com a instrução *"na menor dúvida,
  declare ilegível"*. O contexto separa **arquivos anexados**, **falha no
  recebimento**, **descartados por tamanho** e **degradados** — o bot nunca
  afirma ter visto um exame que não chegou.
- **Eco do próprio bot:** respostas do bot ecoadas pelo webhook (`fromMe`) são
  reconhecidas e descartadas — mesmo dentro de um caso aberto.

## Deploy (produção atual)

### 1. Repositório GitHub
Repo: `edumeloedumelo/AnestBot` — o bot vive na subpasta **`anestbot2/`**.

### 2. UltraMsg
- Crie uma instância em https://ultramsg.com e conecte o número do WhatsApp.
- Anote `Instance ID` e `Token`.
- Em **Settings → Webhook**: ligue o webhook, aponte para
  `https://SEU-APP.up.railway.app/webhook`, e **ative "Webhook On Received"**,
  **"Webhook On Message Create"** (mensagens do próprio número) e
  **"Webhook Download Media: ON"** (obrigatório para os exames chegarem com URL).

### 3. Railway
- Novo projeto → Deploy from GitHub → selecione o repositório.
- **Settings → Root Directory:** `anestbot2`
- **Volumes:** adicione um volume no mount path **`/data`** (persistência).
- **Variables:**
  - `ULTRAMSG_INSTANCE_ID` = seu instance id
  - `ULTRAMSG_TOKEN` = seu token
  - `ANTHROPIC_API_KEY` = sua chave da Anthropic
  - `STATE_DIR` = `/data`
  - `PORT` = `3000` (necessário para o domínio público do Railway)
  - **`ADMIN_NUMBERS`** = números admin separados por vírgula, só dígitos
    (ex.: `5583999999999`). O DDI 55 é opcional — a comparação tolera número
    cadastrado com ou sem ele. ⚠️ **Configure em produção**: se ficar vazio,
    QUALQUER membro do grupo pode rodar comandos de admin (`/resetartudo`,
    `/setprompt`, `/addcirurgia` etc.). O número conectado à UltraMsg é sempre
    admin (`fromMe`).
  - (opcional) `ALLOWED_CHATS` = ids de grupos permitidos (vazio = todos)
  - (opcional) `ANTHROPIC_MODEL` (padrão `claude-sonnet-4-6`)
- O `railway.json` já define builder Dockerfile, healthcheck `/health` e
  `watchPatterns: ["**"]` (todo push dispara deploy).
- ⚠️ **Rode com 1 réplica só**: o store é um arquivo JSON no volume, sem lock
  entre processos — múltiplas réplicas se sobrescreveriam.

### 4. Verificação
Nos logs do primeiro boot deve aparecer:
```
🤖 ANESTBOT ouvindo na porta 3000
✅ Volume persistente OK em /data.     (a partir do 2º deploy)
```
Ao enviar uma ficha, deve aparecer `[webhook] texto gravado ... len=NNNN` com o
tamanho completo do card. No `/analisar`, `[analisar] ... cirurgia="..."`.

Monitoramento recomendado: UptimeRobot em `https://SEU-APP.up.railway.app/health`
a cada 5 minutos.

## Comandos

`/analisar` · `/status` · `/cirurgias` · `/limites` · `/prompt` · `/resetar [N]` ·
`/ajuda` — e (admin) `/addcirurgia` · `/delcirurgia` · `/addlimite` · `/dellimite` ·
`/setprompt` · `/limparprompt` · `/resetartudo`.

### /resetar — o que ele faz

Aberto a todos do grupo (não-admin: máx. 3 casos por vez e 1 uso a cada 120s
por grupo; admin: até 30, sem cooldown).

1. **Reabre APENAS o último caso** (ou os últimos N com `/resetar N`) — os casos
   antigos NUNCA são reanalisados.
2. **Dispara a verificação automática de erros**: varre o estado do bot
   (histórico, dedup, config, volume, API), **corrige sozinho** o que for
   corrigível e **comunica cada correção** no grupo.
3. **Reanalisa o caso reaberto automaticamente** — não precisa mandar
   `/analisar` de novo.

### Comandos do próprio número conectado

O número conectado à UltraMsg também pode enviar comandos (evento
`message_create`) e é tratado **sempre como admin**.

## Testes

```
cd anestbot2 && npm test
```

Suíte com cobertura de: portão de captura, roteamento de mídia órfã (incl. o
cenário Alice/Bruna de contaminação), orçamento de payload, watchdog, detecção
de erros 413, eco do bot, parsers de dimensão de imagem e self-heal do store.

## Estrutura

```
src/
  index.js     — servidor Express + webhook + health
  webhook.js   — normaliza payload UltraMsg → portão de captura → store; comandos
  store.js     — store persistente por chat (mensagens, dedup, casos, mídia órfã)
  parser.js    — divide em casos (xxxx/❌❌❌❌); extrai nome/cirurgia
  commands.js  — /analisar (lock + watchdog) e demais comandos
  triage.js    — contexto + mídia + orçamento de payload; chama o Claude
  media.js     — download com timeout, sniff de tipo, compressão PDF/imagem
  selfcheck.js — verificação automática disparada pelo /resetar
  anthropic.js — API Claude (timeout + ping)
  prompt.js    — system prompt clínico
  format.js    — limpa a saída (remove preâmbulo)
  ultramsg.js  — envio de texto (chunks + timeout + registro anti-eco)
  config.js    — cirurgias/limites/prompt (persistente, com merge)
config.json    — molde de cirurgias e limites
```

> Nota: o arquivo de estado no volume chama-se `anestbot2-store.json` — o nome é
> mantido por compatibilidade com o volume de produção existente.

⚠️ Ferramenta de apoio à decisão. Não substitui avaliação médica presencial.
