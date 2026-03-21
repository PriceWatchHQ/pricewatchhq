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

export default async function urlRoutes(fastify) {
  // Add a URL to watch
  fastify.post('/api/urls', async (request, reply) => {
    const session = getSession(request);
    if (!session) return reply.status(401).send({ error: 'Not authenticated' });

    const { url, label } = request.body || {};

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
    const result = stmt.run(url, label || null, session.user_id);

    return reply.status(201).send({
      id: result.lastInsertRowid,
      url,
      label: label || null,
      user_id: session.user_id,
    });
  });

  // List watched URLs for the authenticated user
  fastify.get('/api/urls', async (request, reply) => {
    const session = getSession(request);
    if (!session) return reply.status(401).send({ error: 'Not authenticated' });

    const rows = db.prepare(
      'SELECT id, url, label, user_id, last_price, last_checked_at, created_at FROM watched_urls WHERE user_id = ? ORDER BY created_at DESC'
    ).all(session.user_id);

    return { urls: rows };
  });

  // Delete a watched URL (only if owned by user)
  fastify.delete('/api/urls/:id', async (request, reply) => {
    const session = getSession(request);
    if (!session) return reply.status(401).send({ error: 'Not authenticated' });

    const { id } = request.params;
    const result = db.prepare('DELETE FROM watched_urls WHERE id = ? AND user_id = ?').run(id, session.user_id);

    if (result.changes === 0) {
      return reply.status(404).send({ error: 'URL not found' });
    }

    return { success: true };
  });

  // TEMPORARY ADMIN: bulk URL management (remove after use)
  fastify.post('/api/admin/urls/bulk', async (request, reply) => {
    const { secret, action, ids, urls_to_add, user_email } = request.body || {};
    if (secret !== process.env.ADMIN_SECRET) return reply.status(403).send({ error: 'forbidden' });

    const user = db.prepare('SELECT id FROM users WHERE email=?').get(user_email);
    if (!user) return reply.status(404).send({ error: 'user not found' });

    const results = { deleted: 0, added: [] };

    if (action === 'delete_by_url_pattern' && ids) {
      for (const pattern of ids) {
        const r = db.prepare('DELETE FROM watched_urls WHERE url LIKE ? AND user_id=?').run(`%${pattern}%`, user.id);
        results.deleted += r.changes;
      }
    }

    if (urls_to_add) {
      const insert = db.prepare('INSERT INTO watched_urls (user_id, label, url) VALUES (?, ?, ?)');
      for (const u of urls_to_add) {
        insert.run(user.id, u.label, u.url);
        results.added.push(u.label);
      }
    }

    return reply.send(results);
  });
}
