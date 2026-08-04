# @anestbot/contracts — contratos de integração bot ⇄ plataforma

Fonte de verdade dos **eventos** trocados entre o bot (`anestbot2/`) e a
plataforma (`apps/api`). Qualquer mudança aqui é versionada no `event_type`
(`*.v1`, `*.v2`, …) — nunca se altera um contrato publicado.

## Envelope (todo evento)

Validado por [`event-envelope.schema.json`](event-envelope.schema.json):

| Campo | Tipo | Regra |
|---|---|---|
| `event_id` | UUID v4 | **Chave de idempotência.** Estável entre retentativas. |
| `event_type` | string | Versionado: `case.received.v1`, … |
| `schema_version` | int | Versão do envelope (atual: 1). |
| `occurred_at` | string | ISO-8601 **UTC** do fato (não do envio). |
| `source` | string | `anestbot2` (bot) ou `platform`. |
| `correlation_id` | string | Agrupa eventos do mesmo caso/fluxo. |
| `chat_ref` | string | Id do grupo WhatsApp — a plataforma resolve o tenant via pareamento (`whatsapp_links`). O bot NÃO conhece tenants. |
| `payload` | object | Corpo específico do tipo (schemas em [`events/`](events/)). |

## Transporte e assinatura (HTTP)

`POST {PLATFORM_EVENTS_URL}` com corpo = envelope JSON e headers:

```
Content-Type: application/json
X-Anestbot-Event-Id:  <event_id>            (idempotência também no header)
X-Anestbot-Timestamp: <epoch segundos do ENVIO>
X-Anestbot-Signature: v1=<hex(HMAC-SHA256(secret, timestamp + "." + corpo_bruto))>
```

Regras do receptor (inbox):
1. Rejeitar **401** se a assinatura não bater (constant-time; aceitar segredo
   primário OU anterior — rotação sem downtime).
2. Rejeitar **401** se `|now - timestamp| > 300s` (anti-replay).
3. Se `event_id` já existe em `inbox_receipts` ⇒ responder **200 sem
   reprocessar** (idempotência; o emissor pode reenviar à vontade).
4. Gravar o recibo E processar na MESMA transação.
5. Corpo acima do limite (1 MB por evento) ⇒ **413**.

Regras do emissor (outbox — implementado em `anestbot2/src/events.js`):
- Evento é gravado no outbox durável **antes** de qualquer tentativa de envio.
- Entrega em ordem (FIFO), com retentativas: backoff exponencial (base 5s,
  fator 2, teto 10 min) + jitter; `attempts` ilimitado até
  `OUTBOX_MAX_ATTEMPTS` (padrão 60) ⇒ move para a dead-letter (nunca descarta
  silenciosamente).
- Replay manual: comando admin `/fila reenviar` devolve a dead-letter à fila
  com os MESMOS `event_id` (o receptor deduplica).
- 2xx = entregue. 4xx ≠ 408/429 = erro permanente ⇒ dead-letter imediata
  (reenviar não conserta contrato). Demais ⇒ retry.

**Critério de resiliência (aceite do Marco 1):** plataforma fora por 30 min ⇒
nenhum evento perdido; ao religar, cada evento processado exatamente uma vez.

## Eventos do bot (v1)

| `event_type` | Quando | Payload (resumo) |
|---|---|---|
| `case.received.v1` | `❌❌❌❌` fecha um caso real | `closed_at`, contadores (`texts`, `media`) |
| `case.analysis_started.v1` | `/analisar` inicia um caso | `case_index`, `total_cases`, contadores |
| `case.analysis_completed.v1` | Laudo emitido | `patient_name`, `surgery`, `anamnesis`, `report_text`, `files` (anexados/falha/descartados/degradados), `errors`, `model`, `prompt_rev` |
| `case.analysis_failed.v1` | Falha na análise | `case_index`, `error` |

> Dados clínicos viajam APENAS no `payload` assinado por HTTPS — nunca em logs
> de nenhum dos lados. Eventos da plataforma (`case.reviewed.v1`,
> `case.override_recorded.v1`, `anesthesia_record.signed.v1`,
> `billing_entry.status_changed.v1`) entram nos Marcos 2–4.
