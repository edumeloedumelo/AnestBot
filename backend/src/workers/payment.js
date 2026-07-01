// Worker de Pagamento: reconcilia tenants com o Stripe pra pegar webhook perdido
// (ex: o servidor caiu no meio de processar um evento). Roda por cima do caminho
// feliz que já existe em routes/billing.js — não substitui os webhooks, cobre a
// lacuna quando eles falham.
import Stripe from 'stripe';
import { pool } from '../db.js';
import { transitionStatus } from '../tenants.js';
import { logEvent } from '../events.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const STATUS_MAP = {
  active: 'active',
  trialing: 'active',
  past_due: 'past_due',
  unpaid: 'past_due',
  incomplete_expired: 'past_due',
  canceled: 'canceled',
};

export async function reconcilePayments() {
  const { rows: tenants } = await pool.query(
    `SELECT * FROM tenants WHERE stripe_subscription_id IS NOT NULL
     AND status IN ('provisioning', 'awaiting_pairing', 'active', 'past_due')`
  );

  for (const tenant of tenants) {
    try {
      const sub = await stripe.subscriptions.retrieve(tenant.stripe_subscription_id);
      const mapped = STATUS_MAP[sub.status];
      // Nunca reativa sozinho de past_due/canceled pra active — isso só acontece
      // via um novo checkout.session.completed (evita reativar cliente que não pagou).
      if (mapped && mapped !== tenant.status && !(mapped === 'active' && tenant.status !== 'provisioning')) {
        await transitionStatus(tenant.id, { source: 'payment', to: mapped, expectedVersion: tenant.status_version });
        await logEvent(tenant.id, 'payment', 'reconciled', { from: tenant.status, to: mapped });
      }
    } catch (e) {
      console.error(`[worker:payment] falha reconciliando tenant ${tenant.id}:`, e.message);
      // Segue pros próximos tenants — uma falha isolada não pode travar o worker inteiro.
    }
  }
}
