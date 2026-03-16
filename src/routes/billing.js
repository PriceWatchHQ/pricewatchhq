import Stripe from 'stripe';
import db from '../db.js';

// Lazy init Stripe client
let _stripe = null;
function getStripe() {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

// Plan config — price IDs are created on first run and cached in DB (using metadata lookup)
const PLANS = {
  starter: { name: 'Starter', amount: 4900, interval: 'month', urls: 25, nickname: 'starter' },
  pro:     { name: 'Pro',     amount: 9900, interval: 'month', urls: 100, nickname: 'pro' },
  business:{ name: 'Business',amount: 19900,interval: 'month', urls: 500, nickname: 'business' },
};

// Ensure prices exist in Stripe (idempotent via lookup_key)
async function getPriceId(planKey) {
  const stripe = getStripe();
  const plan = PLANS[planKey];

  // Search by lookup_key
  const prices = await stripe.prices.list({ lookup_keys: [`pricewatchhq_${planKey}`], limit: 1 });
  if (prices.data.length > 0) return prices.data[0].id;

  // Create product + price
  const product = await stripe.products.create({
    name: `PriceWatchHQ ${plan.name}`,
    metadata: { plan: planKey },
  });

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: plan.amount,
    currency: 'usd',
    recurring: { interval: plan.interval },
    lookup_key: `pricewatchhq_${planKey}`,
  });

  return price.id;
}

// Auth middleware helper
function getSession(req) {
  const token = req.cookies?.session;
  if (!token) return null;
  const now = Date.now();
  return db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?').get(token, now);
}

function getUser(userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

export default async function billingRoutes(app) {
  // POST /api/billing/checkout
  app.post('/api/billing/checkout', async (req, reply) => {
    const session = getSession(req);
    if (!session) return reply.status(401).send({ error: 'Not authenticated' });

    const { plan } = req.body || {};
    if (!PLANS[plan]) return reply.status(400).send({ error: 'Invalid plan' });

    const user = getUser(session.user_id);
    if (!user) return reply.status(401).send({ error: 'User not found' });

    const stripe = getStripe();

    // Get or create Stripe customer
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { user_id: String(user.id) },
      });
      customerId = customer.id;
      db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(customerId, user.id);
    }

    const priceId = await getPriceId(plan);

    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `https://pricewatchhq-production.up.railway.app/api/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: 'https://pricewatchhq.com/pricing',
      metadata: { user_id: String(user.id), plan },
    });

    return reply.send({ url: checkoutSession.url });
  });

  // GET /api/billing/success
  app.get('/api/billing/success', async (req, reply) => {
    const { session_id } = req.query || {};
    if (!session_id) return reply.redirect('/dashboard');

    const stripe = getStripe();

    try {
      const checkoutSession = await stripe.checkout.sessions.retrieve(session_id, {
        expand: ['subscription'],
      });

      if (checkoutSession.payment_status === 'paid' || checkoutSession.status === 'complete') {
        const userId = parseInt(checkoutSession.metadata?.user_id);
        const plan = checkoutSession.metadata?.plan;
        const sub = checkoutSession.subscription;

        if (userId && plan) {
          // Update user plan
          db.prepare('UPDATE users SET plan = ?, stripe_customer_id = ? WHERE id = ?')
            .run(plan, checkoutSession.customer, userId);

          // Upsert subscription record
          const now = Date.now();
          const existing = db.prepare('SELECT id FROM subscriptions WHERE user_id = ?').get(userId);
          if (existing) {
            db.prepare(`UPDATE subscriptions SET stripe_subscription_id = ?, stripe_customer_id = ?, plan = ?, status = ?, updated_at = ? WHERE user_id = ?`)
              .run(sub?.id || null, checkoutSession.customer, plan, 'active', now, userId);
          } else {
            db.prepare(`INSERT INTO subscriptions (user_id, stripe_subscription_id, stripe_customer_id, plan, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
              .run(userId, sub?.id || null, checkoutSession.customer, plan, 'active', now, now);
          }
        }
      }
    } catch (err) {
      console.error('Billing success error:', err);
    }

    return reply.redirect('/dashboard');
  });

  // POST /api/billing/webhook
  app.post('/api/billing/webhook', {
    config: { rawBody: true },
  }, async (req, reply) => {
    const stripe = getStripe();
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
      const rawBody = req.rawBody || req.body;
      if (webhookSecret && sig) {
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
      } else {
        // No webhook secret configured — parse manually (dev/no-secret mode)
        event = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
      }
    } catch (err) {
      return reply.status(400).send({ error: `Webhook error: ${err.message}` });
    }

    const now = Date.now();

    if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object;
      const customerId = sub.customer;
      const status = sub.status; // active, past_due, canceled, etc.

      // Find plan from metadata or price nickname
      let plan = sub.metadata?.plan;
      if (!plan && sub.items?.data?.[0]?.price?.lookup_key) {
        const lk = sub.items.data[0].price.lookup_key;
        plan = lk.replace('pricewatchhq_', '');
      }

      const user = db.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').get(customerId);
      if (user) {
        if (plan && PLANS[plan]) {
          db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(
            status === 'active' ? plan : 'free', user.id
          );
        }
        db.prepare(`UPDATE subscriptions SET status = ?, updated_at = ? WHERE stripe_customer_id = ?`)
          .run(status, now, customerId);
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const customerId = sub.customer;

      const user = db.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').get(customerId);
      if (user) {
        db.prepare('UPDATE users SET plan = ? WHERE id = ?').run('free', user.id);
        db.prepare(`UPDATE subscriptions SET status = ?, updated_at = ? WHERE stripe_customer_id = ?`)
          .run('canceled', now, customerId);
      }
    }

    return reply.send({ received: true });
  });

  // GET /api/billing/portal
  app.get('/api/billing/portal', async (req, reply) => {
    const session = getSession(req);
    if (!session) return reply.status(401).send({ error: 'Not authenticated' });

    const user = getUser(session.user_id);
    if (!user) return reply.status(401).send({ error: 'User not found' });

    if (!user.stripe_customer_id) {
      return reply.status(400).send({ error: 'No billing account found. Please subscribe first.' });
    }

    const stripe = getStripe();
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: 'https://pricewatchhq-production.up.railway.app/dashboard',
    });

    return reply.redirect(portalSession.url);
  });
}
