/**
 * seed-posts.js — Seeds week 1 X posts into the scheduled_posts table.
 * Run once: node src/seed-posts.js
 */

import 'dotenv/config';
import { getDb } from './db.js';

const db = getDb();

// Schedule posts starting tomorrow at 9am CT, one per day
const now = new Date();
const posts = [
  `Just launched @PriceWatchHQ.

The idea: you shouldn't have to manually check what your competitors are charging.

Set a URL. We watch it. You get alerted the moment the price changes.

Building this in public. Follow along. 👀`,

  `Small business owners lose thousands every year because they're slow to react to competitor price changes.

By the time you notice your rival dropped their price 20%, you've already lost the sale.

Automated price monitoring shouldn't be a $500/mo enterprise tool. We're fixing that.`,

  `How PriceWatch HQ works:

1. You add your competitor's product URLs
2. We scrape them on your schedule (daily, hourly, or every 15 min)
3. Price changes? You get an instant alert
4. Dashboard shows the full history

That's it. No fluff.

Waitlist open → https://pricewatchhq.com`,

  `Day 4 of building PriceWatch HQ in public.

Scraper is working. Successfully tracking prices across 3 test sites with <2s response time.

Next up: change detection + email alerts.

The grind is real but so is the progress. 🔨`,

  `If you run an e-commerce store and you're still manually checking competitor prices:

- Opening 10 tabs every morning
- Copy/pasting into a spreadsheet
- Forgetting to check for days at a time

There's a better way. We're building it.

Join the waitlist → https://pricewatchhq.com`,

  `Pricing psychology fact:

Being $1 cheaper than your competitor doesn't just win the price comparison — it changes how buyers perceive your entire brand.

But you can only play this game if you KNOW what your competitor is charging.

Real-time price intelligence = competitive advantage.`,

  `Week 1 of building @PriceWatchHQ:

✅ Scraper core built
✅ Landing page live
✅ Price tracking working on 95% of test URLs

This week: alerts, dashboard, Stripe.

The goal is $1M ARR. Week 1 done. 51 to go. 💪`,
];

// Start tomorrow at 9am local time
const startDate = new Date();
startDate.setDate(startDate.getDate() + 1);
startDate.setHours(9, 0, 0, 0);

const existing = db.prepare('SELECT COUNT(*) as count FROM scheduled_posts').get();
if (existing.count > 0) {
  console.log(`[seed] ${existing.count} posts already in DB, skipping.`);
  process.exit(0);
}

const insert = db.prepare('INSERT INTO scheduled_posts (text, scheduled_for, posted, created_at) VALUES (?, ?, 0, ?)');

for (let i = 0; i < posts.length; i++) {
  const scheduledFor = new Date(startDate);
  scheduledFor.setDate(startDate.getDate() + i);
  insert.run(posts[i], scheduledFor.getTime(), Date.now());
  console.log(`[seed] Scheduled post ${i + 1} for ${scheduledFor.toLocaleString()}`);
}

console.log(`[seed] Done. ${posts.length} posts scheduled.`);
