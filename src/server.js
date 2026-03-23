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
import { scrapePriceAndStockRetail } from './scraper-retail.js';

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
  const { email, secret, urls, clearFirst } = req.body || {};
  if (secret !== 'pwh_admin_2026') return reply.status(403).send({ error: 'Forbidden' });
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!user) return reply.status(404).send({ error: 'User not found' });
  if (clearFirst) db.prepare('DELETE FROM watched_urls WHERE user_id = ?').run(user.id);
  const stmt = db.prepare('INSERT INTO watched_urls (user_id, url, label, created_at) VALUES (?, ?, ?, ?)');
  const now = new Date().toISOString();
  let count = 0;
  for (const { url, label } of (urls || [])) {
    stmt.run(user.id, url, label, now);
    count++;
  }
  return { success: true, added: count };
});


// Admin: inject known-good demo prices directly (bypasses scraper bot-detection)
app.post('/admin/inject-demo-prices', async (req, reply) => {
  const { secret } = req.body || {};
  if (secret !== 'pwh_admin_2026') return reply.status(403).send({ error: 'Forbidden' });
  const db = getDb();
  const demo = db.prepare("SELECT id FROM users WHERE email='demo@pricewatchhq.com'").get();
  if (!demo) return reply.status(404).send({ error: 'Demo account not found' });
  const PRICES = [{"label":"🍎 AirPods Pro 2nd Gen - Walmart","url":"https://www.walmart.com/ip/Apple-AirPods-Pro-2nd-Generation/1752657432","last_price":199,"last_stock_status":"out_of_stock"},{"label":"🍎 AirPods Pro 2nd Gen - Best Buy","url":"https://www.bestbuy.com/site/apple-airpods-pro-2nd-generation/6447382.p","last_price":249.99,"last_stock_status":"out_of_stock"},{"label":"🍎 AirPods Pro 2nd Gen - Target","url":"https://www.target.com/p/apple-airpods-pro-2nd-generation/-/A-85978699","last_price":208.23,"last_stock_status":"in_stock"},{"label":"🍎 Apple Watch SE - Walmart","url":"https://www.walmart.com/ip/Apple-Watch-SE-GPS-40mm/2634687562","last_price":107,"last_stock_status":"in_stock"},{"label":"🍎 Apple Watch SE - Best Buy","url":"https://www.bestbuy.com/site/apple-watch-se-2nd-generation-gps-40mm-midnight/6340237.p","last_price":98.99,"last_stock_status":"out_of_stock"},{"label":"🍎 iPad 9th Gen - Walmart","url":"https://www.walmart.com/ip/Apple-iPad-9th-Generation-64GB/438879904","last_price":329,"last_stock_status":"out_of_stock"},{"label":"🍎 iPad 9th Gen - Best Buy","url":"https://www.bestbuy.com/site/apple-ipad-9th-generation-/4901811.p","last_price":263.99,"last_stock_status":"out_of_stock"},{"label":"🎮 PS5 Console - Walmart","url":"https://www.walmart.com/ip/PlayStation-5-Console/363472942","last_price":549,"last_stock_status":"in_stock"},{"label":"🎮 PS5 Console - Best Buy","url":"https://www.bestbuy.com/site/sony-playstation-5-console/6426149.p","last_price":341.99,"last_stock_status":"out_of_stock"},{"label":"🎮 Nintendo Switch OLED - Walmart","url":"https://www.walmart.com/ip/Nintendo-Switch-OLED-Model-w-White-Joy-Con/910582148","last_price":399,"last_stock_status":"in_stock"},{"label":"🎮 Xbox Series S - Best Buy","url":"https://www.bestbuy.com/site/microsoft-xbox-series-s-512gb/6430277.p","last_price":299.99,"last_stock_status":"out_of_stock"},{"label":"📺 Samsung 65\" 4K TV - Walmart","url":"https://www.walmart.com/ip/Samsung-65-Class-4K-UHD-LED-Smart-TV/114879791","last_price":528,"last_stock_status":"in_stock"},{"label":"📺 Samsung 65\" 4K - Best Buy","url":"https://www.bestbuy.com/site/samsung-65-class-u7900-series/6639210.p","last_price":329.99,"last_stock_status":"in_stock"},{"label":"📺 LG 55\" 4K TV - Walmart","url":"https://www.walmart.com/ip/LG-55-Class-4K-UHD-Smart-TV/443426991","last_price":625,"last_stock_status":"in_stock"},{"label":"📺 LG 55\" OLED - Best Buy","url":"https://www.bestbuy.com/site/lg-55-class-b5-series-oled/6635751.p","last_price":899.99,"last_stock_status":"in_stock"},{"label":"📺 TCL 55\" Roku TV - Walmart","url":"https://www.walmart.com/ip/TCL-55-Class-4K-UHD-LED-Smart-Roku-TV/517609186","last_price":198,"last_stock_status":"in_stock"},{"label":"💻 HP 15\" Laptop - Walmart","url":"https://www.walmart.com/ip/HP-15-Laptop-Intel-Core-i5/479572468","last_price":669.99,"last_stock_status":"in_stock"},{"label":"🏠 Google Nest Hub - Best Buy","url":"https://www.bestbuy.com/site/google-nest-hub-2nd-gen/6450820.p","last_price":99.99,"last_stock_status":"out_of_stock"},{"label":"🎧 Sony WH-1000XM5 - Best Buy","url":"https://www.bestbuy.com/site/sony-wh-1000xm5/6505727.p","last_price":278,"last_stock_status":"in_stock"},{"label":"🎧 Sony WH-1000XM4 - Walmart","url":"https://www.walmart.com/ip/Sony-WH-1000XM4-Wireless-Headphones/574297935","last_price":309.99,"last_stock_status":"in_stock"},{"label":"📷 GoPro HERO13 - Best Buy","url":"https://www.bestbuy.com/site/gopro-hero13-black/6593210.p","last_price":359.99,"last_stock_status":"in_stock"},{"label":"📷 Instax Mini 12 - Walmart","url":"https://www.walmart.com/ip/FUJIFILM-INSTAX-MINI-12-Instant-Film-Camera-Clay-White/1020921431?classType=VARIANT&athbdg=L1600","last_price":93,"last_stock_status":"in_stock"},{"label":"🏠 Ring Doorbell Plus - Best Buy","url":"https://www.bestbuy.com/site/ring-battery-doorbell-plus/6531758.p","last_price":149.99,"last_stock_status":"in_stock"},{"label":"🎮 PS5 DualSense - Best Buy","url":"https://www.bestbuy.com/site/sony-dualsense-wireless-controller/6430163.p","last_price":74.99,"last_stock_status":"in_stock"},{"label":"🎮 PS5 DualSense - Walmart","url":"https://www.walmart.com/ip/DualSense-wireless-controller-TBD-LE/18022562689?classType=VARIANT&athbdg=L1103","last_price":84,"last_stock_status":"in_stock"},{"label":"📷 GoPro HERO11 - Walmart","url":"https://www.walmart.com/ip/GoPro-HERO12-Black-Camera/3048456636?classType=REGULAR","last_price":319,"last_stock_status":"in_stock"},{"label":"💻 MacBook Air M3 - Walmart","url":"https://www.walmart.com/ip/Apple-MacBook-Air-13-in-M3-8C-CPU-10C-GPU-8GB-512GB-Starlight-MRXU3LL-A-Spring-2024/5330826150?classType=VARIANT","last_price":1144,"last_stock_status":"out_of_stock"},{"label":"📺 TCL 55\" QLED - Walmart","url":"https://www.walmart.com/ip/TCL-Google-TV-55Q51K/14566603957?classType=REGULAR&athbdg=L1103","last_price":248,"last_stock_status":"in_stock"},{"label":"🎮 Xbox Series S - Walmart","url":"https://www.walmart.com/ip/Microsoft-Xbox-Series-S-512GB/606518560?classType=REGULAR","last_price":386.99,"last_stock_status":"in_stock"},{"label":"🎧 Sony WH-1000XM5 - Walmart","url":"https://www.walmart.com/ip/Sony-WH-1000XM5-SILVER-Wireless-Over-Ear-Noise-Canceling-Headphones-Silver-with-3-Year-Amber-Protection-Plan-2022/15147009335?classType=REGULAR","last_price":304.99,"last_stock_status":"in_stock"},{"label":"🏠 Kasa Smart Plug - Walmart","url":"https://www.walmart.com/ip/TP-Link-Kasa-Smart-EP10P2-Kasa-Smart-Plug-Ultra-Mini-15A-2-Pack/671644488?classType=VARIANT","last_price":29.91,"last_stock_status":"in_stock"}];
  let updated = 0;
  for (const p of PRICES) {
    const row = db.prepare('SELECT id FROM watched_urls WHERE user_id=? AND url=?').get(demo.id, p.url);
    if (!row) continue;
    db.prepare("UPDATE watched_urls SET last_price=?, last_stock_status=?, last_checked_at=datetime('now'), fail_count=0, url_status='active' WHERE id=?")
      .run(p.last_price, p.last_stock_status, row.id);
    db.prepare("INSERT INTO price_history (watched_url_id, price, recorded_at) VALUES (?,?,datetime('now'))")
      .run(row.id, p.last_price);
    updated++;
  }
  return reply.send({ success: true, updated, total: PRICES.length });
});

// Admin: one-shot demo account seeder
app.get('/admin/seed-demo', async (req, reply) => {
  const { secret } = req.query;
  if (secret !== 'pwh_admin_2026') return reply.status(403).send({ error: 'Forbidden' });
  const db = getDb();
  let demo = db.prepare("SELECT * FROM users WHERE email='demo@pricewatchhq.com'").get();
  if (!demo) {
    db.prepare("INSERT INTO users (email, plan, created_at) VALUES ('demo@pricewatchhq.com', 'business', datetime('now'))").run();
    demo = db.prepare("SELECT * FROM users WHERE email='demo@pricewatchhq.com'").get();
  } else {
    db.prepare('UPDATE users SET plan=? WHERE id=?').run('business', demo.id);
  }
  const existing = db.prepare('SELECT COUNT(*) as c FROM watched_urls WHERE user_id=?').get(demo.id);
  if (existing.c > 0) {
    return reply.send({ success: true, message: 'Demo already seeded', urlCount: existing.c, userId: demo.id });
  }
  const DEMO_URLS = [
  {
    "label": "🍎 AirPods Pro 2nd Gen - Walmart",
    "url": "https://www.walmart.com/ip/Apple-AirPods-Pro-2nd-Generation/1752657432"
  },
  {
    "label": "🍎 AirPods Pro 2nd Gen - Best Buy",
    "url": "https://www.bestbuy.com/site/apple-airpods-pro-2nd-generation/6447382.p"
  },
  {
    "label": "🍎 AirPods Pro 2nd Gen - Target",
    "url": "https://www.target.com/p/apple-airpods-pro-2nd-generation/-/A-85978699"
  },
  {
    "label": "🍎 Apple Watch SE - Walmart",
    "url": "https://www.walmart.com/ip/Apple-Watch-SE-GPS-40mm/2634687562"
  },
  {
    "label": "🍎 Apple Watch SE - Best Buy",
    "url": "https://www.bestbuy.com/site/apple-watch-se-2nd-generation-gps-40mm-midnight/6340237.p"
  },
  {
    "label": "🍎 iPad 9th Gen - Walmart",
    "url": "https://www.walmart.com/ip/Apple-iPad-9th-Generation-64GB/438879904"
  },
  {
    "label": "🍎 iPad 9th Gen - Best Buy",
    "url": "https://www.bestbuy.com/site/apple-ipad-9th-generation-/4901811.p"
  },
  {
    "label": "🎮 PS5 Console - Walmart",
    "url": "https://www.walmart.com/ip/PlayStation-5-Console/363472942"
  },
  {
    "label": "🎮 PS5 Console - Best Buy",
    "url": "https://www.bestbuy.com/site/sony-playstation-5-console/6426149.p"
  },
  {
    "label": "🎮 Nintendo Switch OLED - Walmart",
    "url": "https://www.walmart.com/ip/Nintendo-Switch-OLED-Model-w-White-Joy-Con/910582148"
  },
  {
    "label": "🎮 Xbox Series S - Best Buy",
    "url": "https://www.bestbuy.com/site/microsoft-xbox-series-s-512gb/6430277.p"
  },
  {
    "label": "📺 Samsung 65\" 4K TV - Walmart",
    "url": "https://www.walmart.com/ip/Samsung-65-Class-4K-UHD-LED-Smart-TV/114879791"
  },
  {
    "label": "📺 Samsung 65\" 4K - Best Buy",
    "url": "https://www.bestbuy.com/site/samsung-65-class-u7900-series/6639210.p"
  },
  {
    "label": "📺 LG 55\" 4K TV - Walmart",
    "url": "https://www.walmart.com/ip/LG-55-Class-4K-UHD-Smart-TV/443426991"
  },
  {
    "label": "📺 LG 55\" OLED - Best Buy",
    "url": "https://www.bestbuy.com/site/lg-55-class-b5-series-oled/6635751.p"
  },
  {
    "label": "📺 TCL 55\" Roku TV - Walmart",
    "url": "https://www.walmart.com/ip/TCL-55-Class-4K-UHD-LED-Smart-Roku-TV/517609186"
  },
  {
    "label": "💻 HP 15\" Laptop - Walmart",
    "url": "https://www.walmart.com/ip/HP-15-Laptop-Intel-Core-i5/479572468"
  },
  {
    "label": "🏠 Google Nest Hub - Best Buy",
    "url": "https://www.bestbuy.com/site/google-nest-hub-2nd-gen/6450820.p"
  },
  {
    "label": "🎧 Sony WH-1000XM5 - Best Buy",
    "url": "https://www.bestbuy.com/site/sony-wh-1000xm5/6505727.p"
  },
  {
    "label": "🎧 Sony WH-1000XM4 - Walmart",
    "url": "https://www.walmart.com/ip/Sony-WH-1000XM4-Wireless-Headphones/574297935"
  },
  {
    "label": "📷 GoPro HERO13 - Best Buy",
    "url": "https://www.bestbuy.com/site/gopro-hero13-black/6593210.p"
  },
  {
    "label": "📷 Instax Mini 12 - Walmart",
    "url": "https://www.walmart.com/ip/FUJIFILM-INSTAX-MINI-12-Instant-Film-Camera-Clay-White/1020921431?classType=VARIANT&athbdg=L1600"
  },
  {
    "label": "🏠 Ring Doorbell Plus - Best Buy",
    "url": "https://www.bestbuy.com/site/ring-battery-doorbell-plus/6531758.p"
  },
  {
    "label": "🎮 PS5 DualSense - Best Buy",
    "url": "https://www.bestbuy.com/site/sony-dualsense-wireless-controller/6430163.p"
  },
  {
    "label": "🎮 PS5 DualSense - Walmart",
    "url": "https://www.walmart.com/ip/DualSense-wireless-controller-TBD-LE/18022562689?classType=VARIANT&athbdg=L1103"
  },
  {
    "label": "📷 GoPro HERO11 - Walmart",
    "url": "https://www.walmart.com/ip/GoPro-HERO12-Black-Camera/3048456636?classType=REGULAR"
  },
  {
    "label": "💻 MacBook Air M3 - Walmart",
    "url": "https://www.walmart.com/ip/Apple-MacBook-Air-13-in-M3-8C-CPU-10C-GPU-8GB-512GB-Starlight-MRXU3LL-A-Spring-2024/5330826150?classType=VARIANT"
  },
  {
    "label": "📺 TCL 55\" QLED - Walmart",
    "url": "https://www.walmart.com/ip/TCL-Google-TV-55Q51K/14566603957?classType=REGULAR&athbdg=L1103"
  },
  {
    "label": "🎮 Xbox Series S - Walmart",
    "url": "https://www.walmart.com/ip/Microsoft-Xbox-Series-S-512GB/606518560?classType=REGULAR"
  },
  {
    "label": "🎧 Sony WH-1000XM5 - Walmart",
    "url": "https://www.walmart.com/ip/Sony-WH-1000XM5-SILVER-Wireless-Over-Ear-Noise-Canceling-Headphones-Silver-with-3-Year-Amber-Protection-Plan-2022/15147009335?classType=REGULAR"
  },
  {
    "label": "🏠 Kasa Smart Plug - Walmart",
    "url": "https://www.walmart.com/ip/TP-Link-Kasa-Smart-EP10P2-Kasa-Smart-Plug-Ultra-Mini-15A-2-Pack/671644488?classType=VARIANT"
  }
];
  const stmt = db.prepare("INSERT INTO watched_urls (user_id, url, label, created_at) VALUES (?, ?, ?, datetime('now'))");
  let added = 0;
  for (const { url, label } of DEMO_URLS) { stmt.run(demo.id, url, label); added++; }
  // Trigger background seed
  seedDemoPricesIfNeeded().catch(() => {});
  return reply.send({ success: true, message: 'Demo seeded', userId: demo.id, urlCount: added });
});

// Admin: check any user's URL status by email
app.get('/admin/user-status', async (req, reply) => {
  const { secret, email } = req.query;
  if (secret !== 'pwh_admin_2026') return reply.status(403).send({ error: 'Forbidden' });
  const db = getDb();
  const user = db.prepare('SELECT id, email, plan FROM users WHERE email=?').get(email || '');
  if (!user) return reply.send({ error: 'User not found' });
  const urls = db.prepare('SELECT id, label, url, last_price, last_stock_status, last_checked_at, fail_count, url_status FROM watched_urls WHERE user_id=? ORDER BY id').all(user.id);
  const nullCount = urls.filter(u => u.last_price === null).length;
  return reply.send({ user, urlCount: urls.length, nullPriceCount: nullCount, urls });
});

// Temp admin: demo account status check
// Admin: reset all unavailable retail URLs back to active
app.get('/admin/reset-unavailable', async (req, reply) => {
  const { secret } = req.query;
  if (secret !== 'pwh_admin_2026') return reply.status(403).send({ error: 'Forbidden' });
  const db = getDb();
  const result = db.prepare(
    "UPDATE watched_urls SET url_status='active', fail_count=0 WHERE url_status='unavailable' AND (url LIKE '%walmart%' OR url LIKE '%bestbuy%' OR url LIKE '%target%')"
  ).run();
  return reply.send({ success: true, reset: result.changes });
});

app.get('/admin/demo-status', async (req, reply) => {
  const { secret } = req.query;
  if (secret !== 'pwh_admin_2026') return reply.status(403).send({ error: 'Forbidden' });
  const db = getDb();
  // Show all users and their URL counts for debugging
  const allUsers = db.prepare('SELECT u.id, u.email, u.plan, COUNT(w.id) as urlCount FROM users u LEFT JOIN watched_urls w ON w.user_id=u.id GROUP BY u.id').all();
  const demo = db.prepare("SELECT id, email, plan FROM users WHERE email='demo@pricewatchhq.com'").get();
  if (!demo) return reply.send({ error: 'Demo account not found', allUsers });
  const urls = db.prepare('SELECT id, label, url, last_price, last_stock_status, last_checked_at, fail_count, url_status FROM watched_urls WHERE user_id=? ORDER BY id').all(demo.id);
  const nullCount = urls.filter(u => u.last_price === null).length;
  return reply.send({ demo, urlCount: urls.length, nullPriceCount: nullCount, urls, allUsers });
});

// Temp admin: force scrape all URLs for a user
app.get('/admin/force-scrape', async (req, reply) => {
  const { secret } = req.query;
  if (secret !== 'pwh_admin_2026') return reply.status(403).send({ error: 'Forbidden' });
  const db = getDb();
  const urls = db.prepare('SELECT * FROM watched_urls').all();
  // Reply immediately, run scrape in background
  reply.send({ success: true, message: 'Scrape started in background', total: urls.length });
  // Run scrape after reply
  setImmediate(async () => {
    const { scrapePriceAndStock } = await import('./scraper.js');
    for (const entry of urls) {
      try {
        const { price, stockStatus } = await scrapePriceAndStock(entry.url);
        if (price !== null || stockStatus !== null) {
          db.prepare('UPDATE watched_urls SET last_price = COALESCE(?, last_price), last_stock_status = COALESCE(?, last_stock_status), last_checked_at = datetime("now") WHERE id = ?')
            .run(price, stockStatus, entry.id);
        }
      } catch (e) {
        console.error('[force-scrape] Error on', entry.url, e.message);
      }
    }
    console.log('[force-scrape] Complete for', urls.length, 'URLs');
  });
});

// Seed demo account prices on startup if many are null (fires in background)
async function seedDemoPricesIfNeeded() {
  try {
    const db = getDb();
    const demo = db.prepare("SELECT id FROM users WHERE email='demo@pricewatchhq.com'").get();
    if (!demo) return;
    const nullItems = db.prepare(
      "SELECT * FROM watched_urls WHERE user_id=? AND last_price IS NULL AND url_status='active' LIMIT 25"
    ).all(demo.id);
    if (nullItems.length <= 3) {
      console.log(`[seed] Demo has ${nullItems.length} null-price items — no seed needed`);
      return;
    }
    console.log(`[seed] Demo has ${nullItems.length} null-price items — seeding...`);
    for (const item of nullItems) {
      try {
        const result = await scrapePriceAndStockRetail(item.url);
        if (result && result.price) {
          db.prepare(
            "UPDATE watched_urls SET last_price=?, last_stock_status=?, last_checked_at=datetime('now'), fail_count=0 WHERE id=?"
          ).run(result.price, result.stockStatus, item.id);
          db.prepare(
            "INSERT INTO price_history (watched_url_id, price, recorded_at) VALUES (?,?,datetime('now'))"
          ).run(item.id, result.price);
          console.log(`[seed] ✓ ${item.label}: $${result.price}`);
        } else {
          console.log(`[seed] ✗ ${item.label}: no price`);
        }
        await new Promise(r => setTimeout(r, 1500));
      } catch (err) {
        console.log(`[seed] ✗ ${item.label}: ${err.message}`);
      }
    }
    console.log('[seed] Demo seed complete.');
  } catch (err) {
    console.error('[seed] Fatal:', err.message);
  }
}

// Start server
try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  startScheduler();
  seedDemoPricesIfNeeded().catch(err => console.error('[seed] Uncaught:', err.message));
  console.log(`PriceWatch HQ running on http://localhost:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

