import { randomBytes } from 'crypto';
import db from '../db.js';

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

function getUser(userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

export default async function apiKeyRoutes(app) {
  // GET /api/dashboard/api-keys — list user's API keys (business only)
  app.get('/api/dashboard/api-keys', async (req, reply) => {
    const session = getSession(req);
    if (!session) return reply.status(401).send({ error: 'Not authenticated' });

    const user = getUser(session.user_id);
    if (user?.plan !== 'business') {
      return reply.status(403).send({ error: 'API access requires a Business plan.' });
    }

    const keys = db.prepare(
      'SELECT id, name, key, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC'
    ).all(session.user_id);

    return reply.send({ keys });
  });

  // POST /api/dashboard/api-keys — create a new API key (business only)
  app.post('/api/dashboard/api-keys', async (req, reply) => {
    const session = getSession(req);
    if (!session) return reply.status(401).send({ error: 'Not authenticated' });

    const user = getUser(session.user_id);
    if (user?.plan !== 'business') {
      return reply.status(403).send({ error: 'API access requires a Business plan.' });
    }

    const { name } = req.body || {};
    const key = 'pwq_live_' + randomBytes(16).toString('hex');
    const now = Date.now();

    db.prepare(
      'INSERT INTO api_keys (user_id, key, name, created_at) VALUES (?, ?, ?, ?)'
    ).run(session.user_id, key, name || null, now);

    return reply.status(201).send({ key, name: name || null, created_at: now });
  });

  // DELETE /api/dashboard/api-keys/:id — delete an API key
  app.delete('/api/dashboard/api-keys/:id', async (req, reply) => {
    const session = getSession(req);
    if (!session) return reply.status(401).send({ error: 'Not authenticated' });

    const { id } = req.params;
    const apiKey = db.prepare(
      'SELECT * FROM api_keys WHERE id = ? AND user_id = ?'
    ).get(id, session.user_id);

    if (!apiKey) return reply.status(404).send({ error: 'API key not found' });

    db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
    return reply.send({ ok: true });
  });
}
