// Stripe: checkout de assinatura + webhook idempotente. O worker de Pagamento
// (workers/payment.js) reconcilia por cima disso pra pegar webhook perdido —
// aqui é só o caminho feliz.
import { Router } from 'express';
import Stripe from 'stripe';
import { pool } from '../db.js';
import { getTenant, transitionStatus } from '../tenants.js';
import { claimWebhookEvent, logEvent } from '../events.js';
import { asyncHandler } from '../asyncHandler.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRICE_BY_PLAN = {
  starter: process.env.STRIPE_PRICE_STARTER,
  pro: process.env.STRIPE_PRICE_PRO,
  clinica: process.env.STRIPE_PRICE_CLINICA,
};

export const billingRouter = Router();

billingRouter.post('/checkout', asyncHandler(async (req, res) => {
  const tenant = await getTenant(req.tenantId);
  if (!tenant) return res.status(404).json({ error: 'tenant não encontrado' });

  const priceId = PRICE_BY_PLAN[tenant.plan];
  if (!priceId) return res.status(500).json({ error: `sem price_id configurado pro plano ${tenant.plan}` });

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: tenant.id,
    customer_email: tenant.email,
    success_url: `${process.env.APP_URL || 'https://app.anestguide.com'}/checkout/sucesso`,
    cancel_url: `${process.env.APP_URL || 'https://app.anestguide.com'}/checkout/cancelado`,
    metadata: { tenantId: tenant.id },
    subscription_data: { metadata: { tenantId: tenant.id } },
  });

  res.json({ url: session.url });
}));

// Handler de webhook — montado com express.raw() em index.js (assinatura exige corpo cru).
// Nunca deixa uma exceção subir sem tratamento: um Stripe/Postgres instável não
// pode derrubar o processo inteiro por causa de UM evento de UM tenant.
export async function stripeWebhookHandler(req, res) {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('[stripe-webhook] assinatura inválida:', e.message);
    return res.status(400).send('assinatura inválida');
  }

  try {
    // Se já processamos esse event.id antes (reenvio do Stripe), não repete
    // nenhum efeito colateral.
    const isNew = await claimWebhookEvent(event.id, 'stripe');
    if (!isNew) return res.sendStatus(200);

    try {
      await handleStripeEvent(event);
    } catch (e) {
      console.error('[stripe-webhook] erro processando', event.type, e);
      // não relança: o evento já foi reclamado, o worker de Pagamento reconcilia
      // o que ficou pra trás — mas o processo continua de pé.
    }
    res.sendStatus(200);
  } catch (e) {
    // Falhou antes de conseguir reclamar o evento (ex: banco fora do ar) — responde
    // 500 de propósito, assim o Stripe tenta reenviar esse webhook mais tarde.
    console.error('[stripe-webhook] falha ao reclamar evento, Stripe vai reenviar:', e.message);
    res.sendStatus(500);
  }
}

async function handleStripeEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const tenantId = session.client_reference_id || session.metadata?.tenantId;
      if (!tenantId) return;
      const tenant = await getTenant(tenantId);
      if (!tenant) return;

      await pool.query(
        `UPDATE tenants SET stripe_customer_id = $1, stripe_subscription_id = $2 WHERE id = $3`,
        [session.customer, session.subscription, tenantId]
      );
      await transitionStatus(tenantId, { source: 'payment', to: 'provisioning', expectedVersion: tenant.status_version });
      await logEvent(tenantId, 'payment', 'checkout.completed', { sessionId: session.id });
      break;
    }
    case 'customer.subscription.deleted': {
      await transitionByStripeCustomer(event.data.object.customer, 'canceled', 'subscription.deleted');
      break;
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      if (sub.status === 'active' || sub.status === 'trialing') break; // já está bem
      if (['past_due', 'unpaid', 'incomplete_expired'].includes(sub.status)) {
        await transitionByStripeCustomer(sub.customer, 'past_due', `subscription.${sub.status}`);
      } else if (sub.status === 'canceled') {
        await transitionByStripeCustomer(sub.customer, 'canceled', 'subscription.canceled');
      }
      break;
    }
    case 'invoice.payment_failed': {
      await transitionByStripeCustomer(event.data.object.customer, 'past_due', 'invoice.payment_failed');
      break;
    }
    default:
      break;
  }
}

async function transitionByStripeCustomer(stripeCustomerId, to, reason) {
  const { rows } = await pool.query('SELECT * FROM tenants WHERE stripe_customer_id = $1', [stripeCustomerId]);
  const tenant = rows[0];
  if (!tenant) return;
  await transitionStatus(tenant.id, { source: 'payment', to, expectedVersion: tenant.status_version });
  await logEvent(tenant.id, 'payment', reason, {});
}
