import db from '../db.js';
import { sendWelcomeEmail } from '../mailer.js';

export default async function waitlistRoutes(fastify) {
  fastify.post('/api/waitlist', async (request, reply) => {
    const { email } = request.body || {};

    if (!email || !email.includes('@')) {
      return reply.status(400).send({ error: 'A valid email is required' });
    }

    try {
      db.prepare('INSERT INTO waitlist (email) VALUES (?)').run(email);
    } catch (err) {
      if (err.message.includes('UNIQUE constraint')) {
        return reply.status(409).send({ error: 'Email already on the waitlist' });
      }
      throw err;
    }

    // Send welcome email (non-blocking)
    sendWelcomeEmail({ to: email }).catch(err =>
      console.error('[waitlist] Failed to send welcome email:', err.message)
    );

    return reply.status(201).send({ success: true, email });
  });
}
