# AnestGuide — Bot de WhatsApp (Triagem Pré-Anestésica)

Bot que roda num grupo de WhatsApp: recebe fotos/PDFs de exames + dados da paciente,
analisa com a **API da Anthropic (Claude)** seguindo um protocolo de triagem
pré-anestésica e responde no próprio grupo de forma tabelada (texto monoespaçado).
As cirurgias, exames obrigatórios, limites de referência e instruções extras são
**editáveis por comandos no próprio WhatsApp**.

Stack: **Node.js + Express + UltraMsg + Claude**. Sem n8n, sem banco de dados
(config fica em `config.json`).

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
| `ULTRAMSG_INSTANCE_ID` | ID da instância UltraMsg (ex: `instance12345`) |
| `ULTRAMSG_TOKEN` | Token da instância UltraMsg |
| `ANTHROPIC_API_KEY` | Chave da API Anthropic (`sk-ant-...`) |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` (padrão), `claude-opus-4-8` (mais preciso) ou `claude-haiku-4-5` |
| `PORT` | Porta do servidor (padrão 3000) |
| `ALLOWED_CHATS` | (opcional) ids dos grupos onde o bot atua. Vazio = todos |
| `ADMIN_NUMBERS` | (opcional) números que podem editar a config. Vazio = todos |
| `TRIGGER_PREFIX` | prefixo dos comandos (padrão `/`) |

## 3. Configurar o webhook no UltraMsg

1. Suba o bot num servidor público (Railway, Render, VPS, etc.) — precisa de URL HTTPS.
2. No painel UltraMsg → **Instance Settings → Webhook**:
   - URL: `https://SEU_DOMINIO/webhook`
   - Marque **"On message received"** e ative o envio de mídia.
3. Adicione o número da instância UltraMsg ao grupo de WhatsApp.

> Em desenvolvimento local, exponha a porta com `ngrok http 3000` e use a URL do ngrok.

## 4. Como usar no grupo

1. Mandem as **fotos/PDFs dos exames** no grupo (o bot vai bufferizando).
2. Rodem a análise:
   ```
   /triagem Maria Silva; Mamoplastia; usa Ozempic há 2 meses
   ```
   (`Nome; Cirurgia; anamnese opcional`)
3. O bot responde com o relatório técnico tabelado + bloco-resumo.

## 5. Comandos

**Gerais**
- `/triagem Nome; Cirurgia; anamnese` — analisa os exames enviados
- `/status` — mostra o que está no buffer
- `/limpar` — limpa os exames acumulados
- `/cirurgias` — lista cirurgias e exames exigidos
- `/limites` — lista valores de referência
- `/prompt` — mostra instruções extras ativas
- `/ajuda` — ajuda

**Edição (admin)**
- `/addcirurgia chave; Nome; exame1, exame2` — cria/atualiza cirurgia
- `/delcirurgia chave`
- `/addlimite Exame; descrição; unidade; obs` — cria/atualiza limite
- `/dellimite Exame`
- `/setprompt texto` — adiciona instruções ao protocolo
- `/limparprompt`

## 6. Arquitetura

```
WhatsApp (grupo)
   │  mensagem/mídia
   ▼
UltraMsg ──webhook──▶ Express /webhook (index.js)
                          │
                          ▼
                     router.js ── comando? ──▶ commands.js
                          │  mídia/texto              │
                          ▼                           ▼
                     sessions.js (buffer)         triage.js
                                                      │ system prompt (prompt.js + config.json)
                                                      │ mídias em base64 (ultramsg.js)
                                                      ▼
                                                 Claude (anthropic.js)
                                                      │
                                                 format.js ──▶ sendText ──▶ grupo
```

## 7. Aviso

Ferramenta de **apoio à decisão**. Não substitui avaliação médica presencial.
Atenção à LGPD: dados de pacientes trafegam por UltraMsg e Anthropic — garanta
base legal e, se possível, restrinja `ALLOWED_CHATS`.
