# AnestGuide — Backend (tenants, cobrança, provisionamento)

Dono da verdade sobre clientes, planos, cobrança e uso. O `bot/` (WhatsApp) lê
config/cota do mesmo Postgres, mas quem decide o status de cada tenant
(`pending_payment → provisioning → awaiting_pairing → active → past_due/canceled`)
é este serviço, através de uma máquina de estados com lock otimista
(`src/tenants.js`) — nenhum worker escreve status direto, todos passam por ali.

## 1. Instalação

```bash
cd backend
npm install
cp .env.example .env   # preencha as variáveis
npm run migrate        # aplica o schema no Postgres
npm start
```

## 2. Variáveis de ambiente

Ver `.env.example`. Destaques:
- `TOKEN_ENCRYPTION_KEY` — precisa ser **idêntica** à do `bot/` (cifra/decifra o
  token da UltraMsg salvo em `whatsapp_numbers`).
- `STRIPE_*` — checkout de assinatura + webhook.
- `FIXED_INFRA_COST_BRL` / `COST_PER_TRIAGEM_BRL` (opcionais, com default) —
  usados só pelo `/admin/overview` pra estimar custo/margem ao vivo.

## 3. Endpoints principais

- `POST /auth/signup`, `POST /auth/login` — cadastro/login próprio.
- `POST /billing/checkout` (autenticado) — cria Stripe Checkout Session.
- `POST /webhooks/stripe` — idempotente por `event.id`.
- `GET /onboarding/status` (autenticado) — status do tenant, pro app fazer polling.
- `GET /onboarding/qr` (autenticado) — QR de pareamento da instância UltraMsg do
  tenant. **Endpoint da UltraMsg usado aqui não foi confirmado contra conta
  real** — ver aviso em `src/routes/provisioning.js`.
- `POST /admin/tenants/:tenantId/attach-instance` (owner) — único passo manual
  hoje: cola `{ instanceId, token }` de uma instância UltraMsg criada na mão.
- `GET /admin/overview` (owner) — receita/custo/margem ao vivo + alertas
  críticos (cobrança falhada, provisionamento travado, falhas de execução,
  workers sem heartbeat).

## 4. Workers (rodam em loop dentro do próprio processo, `src/workers/`)

1. **Pagamento** — reconcilia com Stripe (pega webhook perdido).
2. **Provisionamento** — detecta tenant travado em provisioning/awaiting_pairing.
3. **Conexão** — audita status da instância UltraMsg, promove tenant a `active`
   quando o número conecta.
4. **Execução** — monitora `tenant_events` (gravados pelo `bot/`) por falha
   repetida de triagem, alerta se passar do limiar.
5. **Meta-monitor** — heartbeat de cada worker (nome sem relação com a empresa
   Meta); se um travar, aparece em `/admin/overview.alertasCriticos.workersSemHeartbeat`.

Regra de conflito: cancelamento por pagamento sempre vence sobre uma ativação em
andamento — a transição usa lock otimista (`status_version`) e workers que não
são o de Pagamento nunca conseguem escrever por cima de `past_due`/`canceled`.

## 5. Segurança — decisões já corrigidas nesta sessão

- Todo handler async passa por `src/asyncHandler.js` — sem isso, um erro de rede
  (ex: Stripe fora do ar) derrubava o processo Express inteiro, tirando **todos**
  os tenants do ar por causa de um só. Rede de segurança global
  (`unhandledRejection`/`uncaughtException`) só loga, nunca derruba.
- Webhooks (Stripe) são idempotentes por `event.id` (`processed_webhook_events`).
- Tokens de provedor de WhatsApp são criptografados em repouso (`src/crypto.js`,
  AES-256-GCM) — nunca texto puro no banco.

## 6. Pendências conhecidas (ver plano completo pra contexto)

- Preço final por plano **não está travado** — a versão anterior assumia custo
  de mensageria via Meta Cloud API, que se mostrou inviável (grupos exigem
  100k+ conversas/mês). Custo real com UltraMsg é maior; preço precisa ser
  revisto.
- Confirmar contra a conta real da UltraMsg: endpoints de QR/status usados em
  `src/routes/provisioning.js` e `src/workers/connection.js`.
- Nota fiscal (NF-e), revisão jurídica (CFM) e conta de desenvolvedor
  Apple/Google seguem fora do escopo de código.
