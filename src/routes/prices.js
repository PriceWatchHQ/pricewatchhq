import db from '../db.js';

export default async function priceRoutes(fastify) {
  // Get price history for a watched URL
  fastify.get('/api/prices/:urlId', async (request, reply) => {
    const { urlId } = request.params;

    const watchedUrl = db.prepare('SELECT id, url, label FROM watched_urls WHERE id = ?').get(urlId);

    if (!watchedUrl) {
      return reply.status(404).send({ error: 'Watched URL not found' });
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
