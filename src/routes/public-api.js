import db from '../db.js';

// Middleware: validate Bearer token, update last_used_at
async function authenticateApiKey(req, reply) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing or invalid Authorization header. Use: Authorization: Bearer pwq_live_xxx' });
  }

  const token = authHeader.slice(7).trim();
  if (!token.startsWith('pwq_live_')) {
    return reply.status(401).send({ error: 'Invalid API key format.' });
  }

  const apiKey = db.prepare('SELECT * FROM api_keys WHERE key = ?').get(token);
  if (!apiKey) {
    return reply.status(401).send({ error: 'Invalid API key.' });
  }

  // Update last_used_at
  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(Date.now(), apiKey.id);

  req.apiUserId = apiKey.user_id;
}

export default async function publicApiRoutes(app) {
  // GET /api/v1/urls — list user's monitored URLs with latest price
  app.get('/api/v1/urls', { preHandler: authenticateApiKey }, async (req, reply) => {
    const urls = db.prepare(`
      SELECT
        w.id,
        w.label,
        w.url,
        w.last_price,
        w.last_stock_status,
        w.last_checked_at,
        w.created_at
      FROM watched_urls w
      WHERE w.user_id = ?
      ORDER BY w.created_at DESC
    `).all(req.apiUserId);

    return reply.send({ urls });
  });

  // GET /api/v1/urls/:id/history — price history for a URL (last 30 entries)
  app.get('/api/v1/urls/:id/history', { preHandler: authenticateApiKey }, async (req, reply) => {
    const { id } = req.params;

    // Verify ownership
    const watched = db.prepare(
      'SELECT * FROM watched_urls WHERE id = ? AND user_id = ?'
    ).get(id, req.apiUserId);
    if (!watched) return reply.status(404).send({ error: 'URL not found' });

    const history = db.prepare(`
      SELECT price, recorded_at
      FROM price_history
      WHERE watched_url_id = ?
      ORDER BY recorded_at DESC
      LIMIT 30
    `).all(id);

    return reply.send({ url: { id: watched.id, label: watched.label, url: watched.url }, history: history.reverse() });
  });

  // GET /api/v1/alerts — list recent price change events
  app.get('/api/v1/alerts', { preHandler: authenticateApiKey }, async (req, reply) => {
    // Get user's watched URL ids
    const urlIds = db.prepare('SELECT id FROM watched_urls WHERE user_id = ?')
      .all(req.apiUserId).map(r => r.id);

    if (urlIds.length === 0) {
      return reply.send({ alerts: [] });
    }

    // Find price_history entries where price changed from the previous entry for same URL
    // We do this by joining each row with the previous row for the same watched_url_id
    const placeholders = urlIds.map(() => '?').join(',');
    const alerts = db.prepare(`
      SELECT
        ph.id,
        ph.watched_url_id,
        w.label,
        w.url,
        ph.price AS new_price,
        prev.price AS old_price,
        ph.recorded_at
      FROM price_history ph
      JOIN watched_urls w ON w.id = ph.watched_url_id
      JOIN (
        SELECT id, watched_url_id, price,
               ROW_NUMBER() OVER (PARTITION BY watched_url_id ORDER BY recorded_at DESC) AS rn
        FROM price_history
        WHERE watched_url_id IN (${placeholders})
      ) prev ON prev.watched_url_id = ph.watched_url_id
             AND prev.rn = 2
             AND ph.id = (
               SELECT id FROM price_history
               WHERE watched_url_id = ph.watched_url_id
               ORDER BY recorded_at DESC
               LIMIT 1
             )
      WHERE ph.watched_url_id IN (${placeholders})
        AND ph.price != prev.price
      ORDER BY ph.recorded_at DESC
      LIMIT 50
    `).all(...urlIds, ...urlIds);

    return reply.send({ alerts });
  });
}
