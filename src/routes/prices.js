import db from '../db.js';

function getSession(req) {
  const sessionToken = req.cookies?.session;
  if (!sessionToken) return null;
  const now = Date.now();
  const session = db.prepare(
    'SELECT * FROM sessions WHERE token = ? AND expires_at > ?'
  ).get(sessionToken, now);
  return session || null;
}

export default async function priceRoutes(fastify) {
  // Get price history for a watched URL
  fastify.get('/api/prices/:urlId', async (request, reply) => {
    const session = getSession(request);
    if (!session) return reply.status(401).send({ error: 'Not authenticated' });

    const { urlId } = request.params;

    const watchedUrl = db.prepare('SELECT id, url, label, user_id FROM watched_urls WHERE id = ?').get(urlId);

    if (!watchedUrl) {
      return reply.status(404).send({ error: 'Watched URL not found' });
    }

    if (watchedUrl.user_id !== session.user_id) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const history = db.prepare(
      'SELECT id, price, recorded_at FROM price_history WHERE watched_url_id = ? ORDER BY recorded_at DESC'
    ).all(urlId);

    return {
      watched_url: watchedUrl,
      prices: history,
    };
  });
}
