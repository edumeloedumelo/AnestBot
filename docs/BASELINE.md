# BASELINE — resultados reais medidos

Data: 04/08/2026 · Branch: `claude/anestbot-platform-efo1c0` (a partir de `main` @ `625e400`)
Ambiente de auditoria: Linux, Node **v22.22.2**, npm **10.9.7** (produção usa `node:20-slim` via Dockerfile).

## Inventário do repositório

| Caminho | Conteúdo |
|---|---|
| `anestbot2/` | Bot WhatsApp em produção (Railway). 13 módulos ESM em `src/`, runner de testes próprio em `test/run.mjs`. |
| `README.md` | Visão geral do produto e arquitetura do bot. |
| `ANESTBOT-APP-PROMPT.md` | Especificação do produto comercial (dashboard, prontuário, TUSS/CBHPM). |
| `.github/` | **Ausente** — não há CI. |
| `CLAUDE.md`/`AGENTS.md` | **Ausentes** antes desta auditoria (criados agora). |

## Execução do baseline (comandos e resultados reais)

| Verificação | Comando | Resultado |
|---|---|---|
| Instalação reprodutível | `cd anestbot2 && npm ci` | ✅ OK (2 dependências: `dotenv@^16.4.5`, `express@^4.19.2`) |
| Testes | `npm test` (`STATE_DIR=/tmp/anestbot2-test node test/run.mjs`) | ✅ **76 passaram, 0 falharam** |
| Auditoria de dependências | `npm audit` | ✅ **0 vulnerabilidades** |
| Lint | — | ⚠️ Inexistente (sem ESLint/Prettier configurados) |
| Typecheck | — | ⚠️ Inexistente (JS puro, sem tsconfig) |
| Build | — | N/A (não há etapa de build; deploy roda `node src/index.js`) |

## Comportamento real observado no código (não apenas documentado)

- **Webhook-first:** `POST /webhook` responde 200 imediatamente e processa em
  background (`index.js:28-31`). Toda mensagem entre `xxxx` e `❌❌❌❌` é gravada
  no store persistente (`store.js`, arquivo `anestbot2-store.json` em `STATE_DIR`,
  escrita atômica tmp+rename). `/analisar` lê só do store.
- **Portão de captura:** `gateDecision` (`webhook.js:57`) — abre com `xxxx` na 1ª
  linha, fecha com `❌❌❌❌` na última; marcadores colados ao conteúdo funcionam.
  Estado do portão persiste a restarts.
- **Mídia atrasada:** roteamento por timestamp de ENVIO (`handleOrphanMedia`):
  `inside` (antes do fechamento), `late` (≤120s após, com aviso 📎 throttled),
  `pending` (adotada pelo próximo `xxxx` em janela de 120s, nunca por casos antigos).
- **Anti-travamento:** timeouts em todo I/O (download 60s, gs 60s, convert 30s,
  envio 20s, Claude 120s, ping 15s) + watchdog por caso proporcional ao nº de
  exames (base 130s + 130s/arquivo, teto 15min) — `commands.js:21-37`.
- **Orçamento de payload:** 24MB de mídia por requisição; recompressão dos maiores
  primeiro, descarte nomeado em último caso; arquivo nunca fica em duas listas
  contraditórias (`triage.js:76-112`). Anamnese com teto próprio de 500KB.
- **Segurança clínica:** contexto separa anexados / falha no recebimento /
  descartados por tamanho / degradados, com instrução explícita de nunca inventar
  (`triage.js:28-60`); retry de erros de mídia da API nunca remove o bloco 0 (texto).
- **Eco do bot:** respostas enviadas são registradas e reconhecidas quando voltam
  pelo webhook (`store.js:65-77`), checado antes do dispatch de comandos.
- **Dedup durável:** ids processados por grupo (teto 4000); `/resetar [N]` reabre
  só os N últimos casos e dispara selfcheck + reanálise automática.
- **Config editável em runtime:** `config.json` do repo é molde; mesclado no boot
  para `STATE_DIR/config.json` sem apagar edições feitas por comandos.

## Brechas confirmadas na auditoria (endereçadas no Marco 0)

1. **Webhook sem autenticação** — `POST /webhook` aceita qualquer payload de
   qualquer origem. Um payload forjado com `fromMe: true` é tratado como admin
   (`commands.js:60`), permitindo até `/resetartudo` (apaga estado do grupo) e
   `/setprompt` (injeta instruções no prompt clínico). Crítico.
2. **Administração fail-open** — com `ADMIN_NUMBERS` vazio, QUALQUER membro do
   grupo é admin (`commands.js:62`, documentado como ⚠️ no README).
3. **Conteúdo clínico em logs** — `commands.js:125` logava a anamnese
   (`[analisar] TEXTOS:`), `commands.js:124` logava nome do paciente,
   `format.js:14` logava trecho do preâmbulo do laudo (pode conter dados clínicos),
   `triage.js` logava URLs de mídia (dão acesso temporário a exames).
4. **Sem readiness** — só `/health` (liveness); nenhuma checagem de dependências.
5. **Body parser de 60MB** — `express.json({ limit: '60mb' })` permite payloads
   enormes de origem não autenticada (amplificado pela brecha 1).
6. **Sem `.env.example`** — variáveis documentadas apenas no README.
7. **Sem CI** — nenhuma verificação automática em push/PR.

## Suíte de testes existente (preservada integralmente)

76 asserções em `test/run.mjs` cobrindo: getBody/campos variados; marcadores;
extração nome/cirurgia; casos 1–24 (fluxo clássico, marcadores colados,
contaminação Alice/Bruna, dedup, laudo do bot, portão, mídia órfã/atrasada,
reprodução do incidente 29/07, travamento/watchdog, orçamento 413 de 01/08,
regressões de auditoria de 04/08, admin com/sem DDI). Nenhum teste foi removido
ou alterado nesta auditoria.
