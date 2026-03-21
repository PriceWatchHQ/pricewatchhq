import db from '../db.js';
import { PLAN_LIMITS } from '../plans.js';

// Middleware: check session cookie
function getSession(req) {
  const sessionToken = req.cookies?.session;
  if (!sessionToken) return null;
  const now = Date.now();
  const session = db.prepare(
    'SELECT * FROM sessions WHERE token = ? AND expires_at > ?'
  ).get(sessionToken, now);
  return session || null;
}

export default async function dashboardRoutes(app) {
  // GET /api/dashboard/urls — list user's watched URLs with latest price + change
  app.get('/api/dashboard/urls', async (req, reply) => {
    const session = getSession(req);
    if (!session) return reply.status(401).send({ error: 'Not authenticated' });

    const urls = db.prepare(`
      SELECT
        w.id,
        w.label,
        w.url,
        w.last_price,
        w.last_stock_status,
        w.last_checked_at,
        w.created_at,
        w.url_status,
        w.fail_count,
        (
          SELECT ph.price FROM price_history ph
          WHERE ph.watched_url_id = w.id
          ORDER BY ph.recorded_at DESC
          LIMIT 1 OFFSET 1
        ) AS prev_price
      FROM watched_urls w
      WHERE w.user_id = ?
      ORDER BY w.created_at DESC
    `).all(session.user_id);

    const result = urls.map(u => {
      let change = 'same';
      if (u.prev_price !== null && u.prev_price !== undefined && u.last_price !== null) {
        if (u.last_price > u.prev_price) change = 'up';
        else if (u.last_price < u.prev_price) change = 'down';
      }
      return { ...u, change };
    });

    return reply.send({ urls: result });
  });

  // GET /api/dashboard/urls/:id/history — price history gated by plan historyDays
  app.get('/api/dashboard/urls/:id/history', async (req, reply) => {
    const session = getSession(req);
    if (!session) return reply.status(401).send({ error: 'Not authenticated' });

    const { id } = req.params;

    // Verify ownership
    const watched = db.prepare('SELECT * FROM watched_urls WHERE id = ? AND user_id = ?')
      .get(id, session.user_id);
    if (!watched) return reply.status(404).send({ error: 'URL not found' });

    const user = db.prepare('SELECT plan FROM users WHERE id = ?').get(session.user_id);
    const plan = user?.plan || 'free';
    const historyDays = PLAN_LIMITS[plan]?.historyDays ?? PLAN_LIMITS.free.historyDays;
    const since = new Date(Date.now() - historyDays * 24 * 60 * 60 * 1000).toISOString();

    const history = db.prepare(`
      SELECT price, recorded_at
      FROM price_history
      WHERE watched_url_id = ? AND recorded_at >= ?
      ORDER BY recorded_at DESC
      LIMIT 1000
    `).all(id, since);

    return reply.send({ history: history.reverse(), historyDays });
  });

  // GET /api/dashboard/urls/:id/stock-history — stock history gated by plan historyDays
  app.get('/api/dashboard/urls/:id/stock-history', async (req, reply) => {
    const session = getSession(req);
    if (!session) return reply.status(401).send({ error: 'Not authenticated' });

    const { id } = req.params;

    const watched = db.prepare('SELECT * FROM watched_urls WHERE id = ? AND user_id = ?')
      .get(id, session.user_id);
    if (!watched) return reply.status(404).send({ error: 'URL not found' });

    const user = db.prepare('SELECT plan FROM users WHERE id = ?').get(session.user_id);
    const plan = user?.plan || 'free';
    const historyDays = PLAN_LIMITS[plan]?.historyDays ?? PLAN_LIMITS.free.historyDays;
    const since = new Date(Date.now() - historyDays * 24 * 60 * 60 * 1000).toISOString();

    const history = db.prepare(`
      SELECT stock_status, recorded_at
      FROM stock_history
      WHERE watched_url_id = ? AND recorded_at >= ?
      ORDER BY recorded_at DESC
      LIMIT 1000
    `).all(id, since);

    return reply.send({ history: history.reverse(), historyDays });
  });

  // POST /api/dashboard/urls — add a URL to monitor
  app.post('/api/dashboard/urls', async (req, reply) => {
    const session = getSession(req);
    if (!session) return reply.status(401).send({ error: 'Not authenticated' });

    const { label, url } = req.body || {};
    if (!url) return reply.status(400).send({ error: 'URL is required' });

    try {
      new URL(url); // validate URL
    } catch {
      return reply.status(400).send({ error: 'Invalid URL' });
    }

    // Check plan URL limit
    const user = db.prepare('SELECT plan FROM users WHERE id = ?').get(session.user_id);
    const plan = (user?.plan || 'free');
    const limit = PLAN_LIMITS[plan]?.urls ?? PLAN_LIMITS.free.urls;
    const currentCount = db.prepare(
      'SELECT COUNT(*) as count FROM watched_urls WHERE user_id = ?'
    ).get(session.user_id).count;

    if (currentCount >= limit) {
      return reply.status(403).send({ error: 'URL limit reached for your plan. Upgrade to add more.' });
    }

    const result = db.prepare(`
      INSERT INTO watched_urls (user_id, url, label, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(session.user_id, url, label || url);

    const created = db.prepare('SELECT * FROM watched_urls WHERE id = ?').get(result.lastInsertRowid);
    return reply.status(201).send({ url: created });
  });

  // DELETE /api/dashboard/urls/:id — remove a URL
  app.delete('/api/dashboard/urls/:id', async (req, reply) => {
    const session = getSession(req);
    if (!session) return reply.status(401).send({ error: 'Not authenticated' });

    const { id } = req.params;

    const watched = db.prepare('SELECT * FROM watched_urls WHERE id = ? AND user_id = ?')
      .get(id, session.user_id);
    if (!watched) return reply.status(404).send({ error: 'URL not found' });

    db.prepare('DELETE FROM watched_urls WHERE id = ?').run(id);
    return reply.send({ ok: true });
  });

  // GET /api/dashboard/settings — get user's alert settings
  app.get('/api/dashboard/settings', async (req, reply) => {
    const session = getSession(req);
    if (!session) return reply.status(401).send({ error: 'Not authenticated' });

    const user = db.prepare(
      'SELECT slack_webhook_url, phone_number, plan FROM users WHERE id = ?'
    ).get(session.user_id);

    return reply.send({
      slack_webhook_url: user?.slack_webhook_url || null,
      phone_number: user?.phone_number || null,
      plan: user?.plan || 'free',
    });
  });

  // POST /api/dashboard/settings — update user's alert settings
  app.post('/api/dashboard/settings', async (req, reply) => {
    const session = getSession(req);
    if (!session) return reply.status(401).send({ error: 'Not authenticated' });

    const { slack_webhook_url, phone_number } = req.body || {};

    const user = db.prepare('SELECT plan FROM users WHERE id = ?').get(session.user_id);
    const plan = user?.plan || 'free';
    const canSlack = PLAN_LIMITS[plan]?.slackAlerts === true;

    // Gate Slack webhook to Business plan
    if (slack_webhook_url !== undefined && !canSlack) {
      return reply.status(403).send({ error: 'Slack alerts require a Business plan.' });
    }

    db.prepare(
      'UPDATE users SET slack_webhook_url = ?, phone_number = ? WHERE id = ?'
    ).run(
      slack_webhook_url !== undefined ? slack_webhook_url : null,
      phone_number !== undefined ? phone_number : null,
      session.user_id
    );

    return reply.send({ ok: true });
  });

  // GET /api/dashboard/stats — overall stats for the user
  app.get('/api/dashboard/stats', async (req, reply) => {
    const session = getSession(req);
    if (!session) return reply.status(401).send({ error: 'Not authenticated' });

    const totalUrls = db.prepare(
      'SELECT COUNT(*) as count FROM watched_urls WHERE user_id = ?'
    ).get(session.user_id).count;

    const urlIds = db.prepare('SELECT id FROM watched_urls WHERE user_id = ?')
      .all(session.user_id).map(r => r.id);

    let totalChecks = 0;
    if (urlIds.length > 0) {
      const placeholders = urlIds.map(() => '?').join(',');
      totalChecks = db.prepare(
        `SELECT COUNT(*) as count FROM price_history WHERE watched_url_id IN (${placeholders})`
      ).get(...urlIds).count;
    }

    // Alerts sent: placeholder (no alerts table yet)
    const totalAlerts = 0;

    // Plan limit
    const user = db.prepare('SELECT plan FROM users WHERE id = ?').get(session.user_id);
    const plan = (user?.plan || 'free');
    const urlLimit = PLAN_LIMITS[plan]?.urls ?? PLAN_LIMITS.free.urls;

    return reply.send({ totalUrls, totalChecks, totalAlerts, urlLimit, plan });
  });
}
