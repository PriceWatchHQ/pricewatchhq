import 'dotenv/config';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { getDb } from './db.js';
import urlRoutes from './routes/urls.js';
import priceRoutes from './routes/prices.js';
import waitlistRoutes from './routes/waitlist.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import billingRoutes from './routes/billing.js';
import apiKeyRoutes from './routes/api-keys.js';
import publicApiRoutes from './routes/public-api.js';
import { startScheduler } from './scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT, 10) || 3000;

const app = Fastify({
  logger: true,
  // Store raw body for Stripe webhook signature verification
  addContentTypeParser: false,
});

// Capture raw body before parsing (needed for Stripe webhooks)
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
  req.rawBody = body;
  try {
    done(null, JSON.parse(body));
  } catch (err) {
    done(err);
  }
});

app.addContentTypeParser('*', { parseAs: 'buffer' }, (req, body, done) => {
  req.rawBody = body;
  done(null, body);
});

// Cookie support
app.register(fastifyCors, {
  origin: (origin, cb) => {
    const allowed = [
      'https://pricewatchhq.com',
      'https://www.pricewatchhq.com',
      'https://pricewatchhq-production.up.railway.app',
    ];
    if (!origin || allowed.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
});
app.register(fastifyCookie);

// Serve the landing page and static assets
app.register(fastifyStatic, {
  root: join(__dirname, '..', 'public'),
});

// Serve dashboard page at /dashboard
app.get('/dashboard', (req, reply) => {
  return reply.sendFile('dashboard.html');
});



// Serve pricing page
app.get('/pricing', (req, reply) => {
  return reply.sendFile('pricing.html');
});

// Server-side checkout redirect — no JS/CORS needed
app.get('/go/checkout', async (req, reply) => {
  const { plan } = req.query;
  if (!plan) return reply.redirect('/pricing');

  // Check session cookie
  const sessionToken = req.cookies?.session;
  if (!sessionToken) {
    return reply.redirect(`/dashboard?next=/go/checkout?plan=${plan}`);
  }

  const db = getDb();
  const now = Date.now();
  const session = db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?').get(sessionToken, now);
  if (!session) return reply.redirect(`/dashboard?next=/go/checkout?plan=${plan}`);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  if (!user) return reply.redirect('/dashboard');

  const PLANS = { starter: true, pro: true, business: true };
  if (!PLANS[plan]) return reply.redirect('/pricing');

  try {
    const StripeModule = await import('stripe');
    const Stripe = StripeModule.default || StripeModule;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { user_id: String(user.id) },
      });
      customerId = customer.id;
      db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(customerId, user.id);
    }

    const PRICE_MAP = { starter: 4900, pro: 9900, business: 19900 };
    const priceData = await stripe.prices.list({ lookup_keys: [`${plan}_monthly`], limit: 1 });
    let priceId;
    if (priceData.data.length > 0) {
      priceId = priceData.data[0].id;
    } else {
      const product = await stripe.products.create({ name: `PriceWatch HQ ${plan.charAt(0).toUpperCase() + plan.slice(1)}` });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: PRICE_MAP[plan],
        currency: 'usd',
        recurring: { interval: 'month' },
        lookup_key: `${plan}_monthly`,
      });
      priceId = price.id;
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `https://pricewatchhq-production.up.railway.app/api/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://pricewatchhq-production.up.railway.app/pricing`,
      metadata: { user_id: String(user.id), plan },
    });

    return reply.redirect(checkoutSession.url);
  } catch (err) {
    console.error('[checkout]', err.message);
    return reply.redirect('/pricing?error=1');
  }
});

// Register API routes
app.register(urlRoutes);
app.register(priceRoutes);
app.register(waitlistRoutes);
app.register(authRoutes);
app.register(dashboardRoutes);
app.register(billingRoutes);
app.register(apiKeyRoutes);
app.register(publicApiRoutes);

// Temp admin endpoint — upgrade user plan
app.get('/admin/upgrade', async (req, reply) => {
  const { email, plan, secret } = req.query;
  if (secret !== 'pwh_admin_2026') return reply.status(403).send({ error: 'Forbidden' });
  if (!email || !plan) return reply.status(400).send({ error: 'email and plan required' });
  const db = getDb();
  const result = db.prepare('UPDATE users SET plan = ? WHERE email = ?').run(plan, email);
  if (result.changes === 0) return reply.status(404).send({ error: 'User not found' });
  return { success: true, email, plan };
});


// Temp admin: bulk add URLs for a user
app.post('/admin/bulk-urls', async (req, reply) => {
  const { email, secret, urls } = req.body || {};
  if (secret !== 'pwh_admin_2026') return reply.status(403).send({ error: 'Forbidden' });
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!user) return reply.status(404).send({ error: 'User not found' });
  const stmt = db.prepare('INSERT INTO watched_urls (user_id, url, label, created_at) VALUES (?, ?, ?, ?)');
  const now = new Date().toISOString();
  let count = 0;
  for (const { url, label } of urls) {
    stmt.run(user.id, url, label, now);
    count++;
  }
  return { success: true, added: count };
});
// Start server
try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  startScheduler();
  console.log(`PriceWatch HQ running on http://localhost:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

