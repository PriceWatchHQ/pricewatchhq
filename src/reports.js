/**
 * reports.js — Daily sales and activity reports for PriceWatchHQ
 * Sends a morning briefing to Skyler via the OpenClaw workspace log.
 * Once Stripe is approved, this will show real revenue data.
 */

import 'dotenv/config';
import { getDb } from './db.js';

function getStripe() {
  const Stripe = require('stripe');
  return Stripe(process.env.STRIPE_SECRET_KEY);
}

export async function getDailyReport() {
  const db = getDb();

  // Waitlist signups
  const totalWaitlist = db.prepare('SELECT COUNT(*) as count FROM waitlist').get().count;
  const newToday = db.prepare(`
    SELECT COUNT(*) as count FROM waitlist
    WHERE created_at >= datetime('now', '-1 day')
  `).get().count;

  // Active users and URLs
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const totalUrls = db.prepare('SELECT COUNT(*) as count FROM watched_urls').get().count;
  const totalChecks = db.prepare('SELECT COUNT(*) as count FROM price_history').get().count;

  // Scheduled posts status
  const postsRemaining = db.prepare('SELECT COUNT(*) as count FROM scheduled_posts WHERE posted = 0').get().count;
  const nextPost = db.prepare(`
    SELECT text, scheduled_for FROM scheduled_posts
    WHERE posted = 0 ORDER BY scheduled_for ASC LIMIT 1
  `).get();

  // Stripe revenue (if available)
  let stripeData = { grossVolume: 0, netVolume: 0, newCustomers: 0, activeSubscriptions: 0 };
  if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY !== 'pending') {
    try {
      const stripe = getStripe();
      const now = Math.floor(Date.now() / 1000);
      const dayAgo = now - 86400;

      const [charges, subs] = await Promise.all([
        stripe.charges.list({ created: { gte: dayAgo }, limit: 100 }),
        stripe.subscriptions.list({ status: 'active', limit: 100 }),
      ]);

      stripeData.grossVolume = charges.data.reduce((sum, c) => sum + (c.amount / 100), 0);
      stripeData.netVolume = charges.data.reduce((sum, c) => sum + ((c.amount - (c.application_fee_amount || 0)) / 100), 0);
      stripeData.newCustomers = charges.data.length;
      stripeData.activeSubscriptions = subs.data.length;
    } catch (err) {
      // Stripe not active yet
    }
  }

  const nextPostTime = nextPost
    ? new Date(nextPost.scheduled_for).toLocaleString('en-US', { timeZone: 'America/Chicago' })
    : 'None scheduled';

  return {
    date: new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'long', day: 'numeric' }),
    waitlist: { total: totalWaitlist, newToday },
    users: { total: totalUsers, totalUrls, totalChecks },
    stripe: stripeData,
    xPosts: { remaining: postsRemaining, nextPostTime },
  };
}

export function formatReport(report) {
  const { date, waitlist, users, stripe, xPosts } = report;
  return `
📊 PriceWatchHQ Daily Report — ${date}

💰 Revenue (last 24h)
  Gross: $${stripe.grossVolume.toFixed(2)}
  Active subscriptions: ${stripe.activeSubscriptions}

📋 Waitlist
  Total signups: ${waitlist.total}
  New today: ${waitlist.newToday}

🔍 Monitoring
  Active users: ${users.total}
  URLs tracked: ${users.totalUrls}
  Total price checks: ${users.totalChecks}

📣 X Posts
  Posts remaining: ${xPosts.remaining}
  Next post: ${xPosts.nextPostTime}
`.trim();
}
