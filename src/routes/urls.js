import db from '../db.js';

export default async function urlRoutes(fastify) {
  // Add a URL to watch
  fastify.post('/api/urls', async (request, reply) => {
    const { url, label, user_id } = request.body || {};

    if (!url) {
      return reply.status(400).send({ error: 'url is required' });
    }

    try {
      new URL(url); // validate URL format
    } catch {
      return reply.status(400).send({ error: 'Invalid URL format' });
    }

    const stmt = db.prepare(
      'INSERT INTO watched_urls (url, label, user_id) VALUES (?, ?, ?)'
    );
    const result = stmt.run(url, label || null, user_id || null);

    return reply.status(201).send({
      id: result.lastInsertRowid,
      url,
      label: label || null,
      user_id: user_id || null,
    });
  });

  // List all watched URLs
  fastify.get('/api/urls', async (request) => {
    const rows = db.prepare(
      'SELECT id, url, label, user_id, last_price, last_checked_at, created_at FROM watched_urls ORDER BY created_at DESC'
    ).all();

    return { urls: rows };
  });

  // Delete a watched URL
  fastify.delete('/api/urls/:id', async (request, reply) => {
    const { id } = request.params;
    const result = db.prepare('DELETE FROM watched_urls WHERE id = ?').run(id);

    if (result.changes === 0) {
      return reply.status(404).send({ error: 'URL not found' });
    }

    return { success: true };
  });
}
