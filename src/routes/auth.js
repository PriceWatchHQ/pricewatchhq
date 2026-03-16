import { randomBytes } from 'crypto';
import db from '../db.js';

const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days in ms
const LOGIN_TOKEN_TTL = 15 * 60 * 1000; // 15 minutes in ms

function generateToken() {
  return randomBytes(32).toString('hex');
}

export default async function authRoutes(app) {
  // POST /api/auth/login — create magic link token
  app.post('/api/auth/login', async (req, reply) => {
    const { email } = req.body || {};
    if (!email || !email.includes('@')) {
      return reply.status(400).send({ error: 'Valid email required' });
    }

    const now = Date.now();
    const token = generateToken();
    const expiresAt = now + LOGIN_TOKEN_TTL;

    // Clean up expired tokens for this email
    db.prepare('DELETE FROM login_tokens WHERE email = ? OR expires_at < ?').run(email, now);

    // Insert new login token
    db.prepare('INSERT INTO login_tokens (token, email, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(token, email, now, expiresAt);

    // In dev mode, return the token directly. In production, email it.
    return reply.send({
      message: 'Magic link created (dev mode — token returned directly)',
      email,
      token,
      // This is the URL they'd click in the email
      loginUrl: `/api/auth/verify?token=${token}`,
    });
  });

  // GET /api/auth/verify — verify magic link token, create session
  app.get('/api/auth/verify', async (req, reply) => {
    const { token } = req.query || {};
    if (!token) {
      return reply.status(400).send({ error: 'Token required' });
    }

    const now = Date.now();
    const loginToken = db.prepare(
      'SELECT * FROM login_tokens WHERE token = ? AND expires_at > ?'
    ).get(token, now);

    if (!loginToken) {
      return reply.status(401).send({ error: 'Invalid or expired token' });
    }

    // Delete the used token
    db.prepare('DELETE FROM login_tokens WHERE token = ?').run(token);

    // Upsert user
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(loginToken.email);
    if (!user) {
      db.prepare('INSERT INTO users (email, created_at) VALUES (?, datetime(\'now\'))').run(loginToken.email);
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(loginToken.email);
    }

    // Create session
    const sessionToken = generateToken();
    const expiresAt = now + SESSION_TTL;
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(sessionToken, user.id, now, expiresAt);

    // Set cookie and redirect to dashboard
    reply.setCookie('session', sessionToken, {
      httpOnly: true,
      path: '/',
      maxAge: SESSION_TTL / 1000,
      sameSite: 'lax',
    });

    return reply.redirect('/dashboard');
  });

  // GET /api/auth/me — get current user
  app.get('/api/auth/me', async (req, reply) => {
    const sessionToken = req.cookies?.session;
    if (!sessionToken) {
      return reply.status(401).send({ error: 'Not authenticated' });
    }

    const now = Date.now();
    const session = db.prepare(
      'SELECT * FROM sessions WHERE token = ? AND expires_at > ?'
    ).get(sessionToken, now);

    if (!session) {
      return reply.status(401).send({ error: 'Invalid or expired session' });
    }

    const user = db.prepare('SELECT id, email, name, plan, created_at FROM users WHERE id = ?').get(session.user_id);
    if (!user) {
      return reply.status(401).send({ error: 'User not found' });
    }

    return reply.send({ user });
  });

  // POST /api/auth/logout — clear session
  app.post('/api/auth/logout', async (req, reply) => {
    const sessionToken = req.cookies?.session;
    if (sessionToken) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(sessionToken);
    }
    reply.clearCookie('session', { path: '/' });
    return reply.send({ ok: true });
  });
}
