# ANESTBOT

**Triagem pré-anestésica automatizada no WhatsApp** — para equipes de anestesiologia e cirurgia plástica de alto padrão.

A equipe envia a ficha de anamnese e os exames do paciente no grupo do WhatsApp; o ANESTBOT lê tudo (texto completo + PDFs + fotos de exames), avalia contra os critérios clínicos configurados (hemoglobina mínima, BIRADS, sorologias, GLP-1, jejum, ASA, etc.) e devolve um parecer estruturado com **STATUS**, exames conferidos item a item e **PENDÊNCIAS** numeradas.

```
xxxx                          ← abre o caso
[ficha da anamnese + exames]  ← texto, PDFs e fotos
❌❌❌❌                        ← fecha o caso
/analisar                     ← dispara a triagem
```

## Onde está o código

| Pasta | Conteúdo |
|---|---|
| **[`anestbot2/`](anestbot2/)** | ✅ **ANESTBOT (versão atual, em produção)** — arquitetura webhook-first. Comece por aqui. |
| `bot/` | Versão 1.0 (legado, desativada) — mantida só como histórico. |
| demais pastas | Protótipos antigos sem relação com o bot (app Base44, etc.). |

Toda a documentação de arquitetura, deploy (Railway + UltraMsg) e comandos está no **[README do `anestbot2/`](anestbot2/README.md)**.

## Destaques da arquitetura atual

- **Webhook-first:** cada mensagem é gravada em tempo real com o texto **completo** — imune ao truncamento do `GET /chats/messages` da UltraMsg (causa raiz dos bugs da 1.0).
- **Portão de captura:** o bot só armazena o que está **entre `xxxx` e `❌❌❌❌`**; comandos funcionam em grupos e no privado, mas nada fora do portão é lido.
- **Mídia atrasada sem contaminação:** webhooks de mídia da UltraMsg chegam minutos depois do texto; o roteamento usa o timestamp de **envio** no WhatsApp, garantindo que exame nenhum caia no paciente errado.
- **Anti-travamento:** timeout em todo I/O + watchdog por caso — o bot nunca fica preso segurando o lock.
- **Orçamento de payload:** casos com dezenas de exames são comprimidos/adaptados para nunca estourar o limite da API (413), com aviso explícito de qualquer arquivo degradado ou descartado.
- **Segurança clínica:** na menor dúvida de leitura o bot declara o exame ilegível e pede reenvio — nunca inventa um valor.

## Stack

Node.js 20 + Express · UltraMsg (WhatsApp) · Claude API (Anthropic) · Railway (deploy, volume persistente) · Docker (ghostscript + imagemagick para PDFs e imagens).

---

⚠️ **Ferramenta de apoio à decisão. Não substitui avaliação médica presencial.**
