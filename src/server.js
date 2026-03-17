import 'dotenv/config';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import urlRoutes from './routes/urls.js';
import priceRoutes from './routes/prices.js';
import waitlistRoutes from './routes/waitlist.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import billingRoutes from './routes/billing.js';
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
  origin: ['https://pricewatchhq.com', 'https://www.pricewatchhq.com'],
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

// Register API routes
app.register(urlRoutes);
app.register(priceRoutes);
app.register(waitlistRoutes);
app.register(authRoutes);
app.register(dashboardRoutes);
app.register(billingRoutes);

// Start server
try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  startScheduler();
  console.log(`PriceWatch HQ running on http://localhost:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
