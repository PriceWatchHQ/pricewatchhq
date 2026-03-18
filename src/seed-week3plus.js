import { getDb } from './db.js';

const db = getDb();

// Start March 24 at 9am CT (14:00 UTC), one per day
const start = 1774360800000;
const day = 86400000;
const now = Date.now();

const posts = [
  // Day 8 - March 24
  `Day 8 building @PriceWatchHQ in public.

Backend is live. Scraper is running.

Biggest surprise so far: how many e-commerce founders are still using spreadsheets to track competitor prices.

That's the market. That's who we're building for.`,

  // Day 9 - March 25
  `The competitor pricing problem nobody talks about:

It's not just that you miss price drops.

It's that you find out 3 days later, after you've already lost 47 sales to the store that reacted in 2 hours.

Speed of information = competitive advantage.`,

  // Day 10 - March 26
  `PriceWatch HQ tracks any product URL — not just Amazon.

Shopify stores. WooCommerce. Custom retail sites.

If there's a price on the page, we find it.

Try it → https://pricewatchhq.com`,

  // Day 11 - March 27
  `Pricing truth most founders ignore:

Your price isn't set in a vacuum. It's set relative to every competitor your customer just looked at.

If you don't know what those are, you're flying blind.

Real-time price intel fixes this.`,

  // Day 12 - March 28
  `Building a SaaS solo means making 100 decisions a day with incomplete information.

But some decisions are clear:

The problem is real. The market is huge. The existing tools are overpriced.

Ship it. Iterate. Grow.

Week 2 underway. 💪`,

  // Day 13 - March 29
  `Some numbers on competitor price monitoring:

• 73% of online shoppers compare prices before buying
• Average e-commerce store checks competitors manually 2x/week
• Average time spent: 45 min per session

That's 78 hours/year. We do it every 15 minutes.`,

  // Day 14 - March 30
  `Week 2 of building @PriceWatchHQ in public.

What's working:
✅ Scraper accuracy improving
✅ Alert system live
✅ First real users testing

What's next:
→ Better onboarding
→ More URL coverage
→ Dashboard improvements

The goal is $1M ARR. Keep moving.`,

  // Day 15 - March 31
  `Real scenario:

Your competitor drops their price on Friday at 5pm.

You don't notice until Monday morning.

That's 60 hours of lost competitive positioning.

PriceWatch HQ alerts you within 15 minutes. Every day. Including weekends.`,

  // Day 16 - April 1
  `No April Fools here — just shipping.

Added smarter change detection this week. Now handles:
• Dynamic pricing pages
• Currency formatting variations
• Sites that load prices via JS

Coverage keeps getting better.`,

  // Day 17 - April 2
  `The best pricing strategy is a dynamic one.

But dynamic pricing requires data.

Data requires monitoring.

Monitoring requires automation.

That's the chain. We handle the last 3 steps so you can focus on the first.

→ https://pricewatchhq.com`,

  // Day 18 - April 3
  `Something I didn't expect building this:

The hardest part isn't the scraper.

It's normalizing prices across 1000 different page layouts, currencies, and "sale" formats.

Every retailer builds their pricing display differently. Our job is to make sense of all of it.`,

  // Day 19 - April 4
  `If you run an e-commerce store with 3+ competitors:

You're leaving money on the table without price monitoring.

Not because your prices are wrong — but because you don't know when they become wrong.

Fix that → https://pricewatchhq.com`,

  // Day 20 - April 5
  `Pricing psychology deep dive:

Charm pricing ($9.99 vs $10) works.
Anchor pricing works.
Competitive undercutting works.

None of them work if you don't know what your competitors are charging.

Intelligence first. Strategy second.`,

  // Day 21 - April 6
  `3 weeks building @PriceWatchHQ in public.

The market is real. The pain is real. The solution works.

Now it's a distribution game.

Week 4 starts tomorrow. Still a long way to $1M ARR but the foundation is solid. 🔨`,

  // Day 22 - April 7
  `PriceWatch HQ alert types:

📧 Email — instant, works on any plan
📱 SMS — for when you need it NOW (Pro+)
🔔 Slack — keeps your team in the loop (Business)

Set it up once. Never miss a price change again.

→ https://pricewatchhq.com`,

  // Day 23 - April 8
  `The "I'll check it manually" trap:

Day 1: check competitors every morning ✅
Week 2: forget twice ⚠️
Month 2: check once a week ❌
Month 3: haven't checked in 3 weeks 🔥

Manual processes decay. Automated ones don't.

That's why we built this.`,

  // Day 24 - April 9
  `Build in public update:

Scraper is now handling JS-rendered prices on most major platforms.

This was the #1 request from early users — a lot of modern storefronts render prices client-side.

Shipping the things people actually ask for. 🚀`,

  // Day 25 - April 10
  `Price monitoring ROI math:

If catching one competitor price drop helps you win 10 extra sales at $50 avg order value = $500

PriceWatch HQ costs $49/mo

One alert pays for 10 months.

Most stores see multiple price changes per week.`,

  // Day 26 - April 11
  `Solo founder truth:

There's no team to blame. No meetings to hide in. No "we'll revisit next quarter."

Just you, the product, and the market.

It's brutal and clarifying at the same time.

Day 26 of building @PriceWatchHQ. Still here. Still shipping.`,

  // Day 27 - April 12
  `E-commerce stat worth knowing:

Price is the #1 factor in purchase decisions for 60% of online shoppers.

Not brand. Not shipping speed. Price.

If you're not tracking what your competitors charge, you're ignoring the thing your customers care about most.`,

  // Day 28 - April 13
  `4 weeks building @PriceWatchHQ in public.

Started with an idea. Built the scraper. Launched the product. Growing every day.

This is what building in public looks like — messy, real, and moving forward.

The $1M ARR goal is still the target. 💪`
];

const stmt = db.prepare('INSERT INTO scheduled_posts (text, scheduled_for, posted, created_at) VALUES (?, ?, 0, ?)');

posts.forEach((text, i) => {
  stmt.run(text, start + (i * day), now);
});

console.log(`Inserted ${posts.length} posts`);

const total = db.prepare('SELECT COUNT(*) as count FROM scheduled_posts WHERE posted = 0').get();
const last = db.prepare('SELECT scheduled_for FROM scheduled_posts WHERE posted = 0 ORDER BY scheduled_for DESC LIMIT 1').get();
console.log(`Total queued: ${total.count}`);
console.log(`Queue runs through: ${new Date(last.scheduled_for).toDateString()}`);
