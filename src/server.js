import 'dotenv/config';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import urlRoutes from './routes/urls.js';
import priceRoutes from './routes/prices.js';
import waitlistRoutes from './routes/waitlist.js';
import { startScheduler } from './scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT, 10) || 3000;

const app = Fastify({ logger: true });

// Serve the landing page and static assets
app.register(fastifyStatic, {
  root: join(__dirname, '..', 'public'),
});

// Register API routes
app.register(urlRoutes);
app.register(priceRoutes);
app.register(waitlistRoutes);

// Start server
try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  startScheduler();
  console.log(`PriceWatch HQ running on http://localhost:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
