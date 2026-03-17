import { getDb } from './db.js';

export default async function seedWeek2() {
  const db = getDb();

  const posts = [
    { text: `Your competitor just dropped their price.\n\nYou won't find out until a customer tells you they bought from them instead.\n\nThat's the problem PriceWatch HQ solves.\n\nFree to start → https://pricewatchhq.com`, hour: 9, day: 24 },
    { text: `The math on competitor price monitoring:\n\nMiss one price drop = lose 20 sales\nAverage order value = $75\nRevenue lost = $1,500\n\nCost of PriceWatch HQ = $49/mo\n\nThe ROI writes itself.`, hour: 18, day: 24 },
    { text: `3 signs you need automated price monitoring:\n\n1. You check competitor sites manually every morning\n2. You've lost sales because you were slow to match a price drop\n3. You have more than 5 competitors to track\n\nSound familiar? → https://pricewatchhq.com`, hour: 9, day: 25 },
    { text: `Build in public update:\n\nWeek 2 of @PriceWatchHQ.\n\nWhat's live:\n✅ Price monitoring (any URL)\n✅ Email + SMS alerts\n✅ Full price history dashboard\n✅ Free plan — no credit card needed\n\nTry it free → https://pricewatchhq.com`, hour: 14, day: 25 },
    { text: `Hot take: most e-commerce businesses are flying blind on pricing.\n\nThey set a price at launch and revisit it quarterly.\n\nMeanwhile competitors are making micro-adjustments daily.\n\nReal-time price intelligence is the edge most stores don't have yet.`, hour: 19, day: 25 },
    { text: `How our scraper works:\n\n1. You paste a competitor product URL\n2. We fetch the page on your schedule\n3. Extract the price using smart pattern matching\n4. Compare to last known price\n5. Alert you if anything changed\n\nSimple. Fast. Reliable.\n\n→ https://pricewatchhq.com`, hour: 9, day: 26 },
    { text: `Pricing strategies that actually work:\n\n→ Always be $1 below your main competitor\n→ Match price drops within 24 hours\n→ Raise prices when competitors go out of stock\n\nNone of this is possible if you don't know what competitors are charging.\n\nThat's what we track. → https://pricewatchhq.com`, hour: 18, day: 26 },
    { text: `Free plan just dropped.\n\nMonitor 3 competitor URLs. No credit card. No catch.\n\nFor small stores just getting started with price intelligence.\n\n→ https://pricewatchhq.com`, hour: 9, day: 27 },
    { text: `The moment that made me build this:\n\nA friend running an Amazon store found out a competitor slashed prices — from a customer complaint, 3 days later.\n\nBy then they'd lost hundreds of sales.\n\n"If only I knew the day it happened."\n\nSo I built the thing that tells you.`, hour: 13, day: 27 },
    { text: `What our Business plan includes:\n\n✅ 500 monitored URLs\n✅ 15-minute price checks\n✅ Email + SMS + Slack alerts\n✅ Full API access\n✅ Unlimited price history\n\nFor $199/mo — less than one lost sale.\n\n→ https://pricewatchhq.com`, hour: 9, day: 28 },
    { text: `Most price monitoring tools cost $500+/mo and are built for enterprise.\n\nWe built PriceWatch HQ for the small/medium store owner who just wants to know when a competitor changes their price.\n\nStarts at $0. → https://pricewatchhq.com`, hour: 18, day: 28 },
    { text: `If you sell online, you have competitors.\nIf you have competitors, their prices affect yours.\nIf their prices affect yours, you need to know when they change.\n\nThat's it. That's the whole pitch.\n\n→ https://pricewatchhq.com`, hour: 9, day: 29 },
    { text: `2 weeks of building @PriceWatchHQ in public.\n\nWhat's shipped:\n✅ Price monitoring engine\n✅ Email, SMS, Slack alerts\n✅ User dashboard\n✅ Free + 3 paid plans\n✅ Public API for Business users\n\nGoal: $1M ARR. Week 2 of 52. Let's go. 💪`, hour: 9, day: 30 },
    { text: `The question I get most:\n\n"Does it work on JavaScript-heavy sites?"\n\nMostly yes. We use smart extraction that handles most modern e-commerce sites.\n\nSites we've tested: Amazon, Shopify stores, WooCommerce, BigCommerce.\n\n→ https://pricewatchhq.com`, hour: 18, day: 30 },
  ];

  const insert = db.prepare('INSERT OR IGNORE INTO scheduled_posts (text, scheduled_for, posted, created_at) VALUES (?, ?, 0, ?)');
  let added = 0;

  for (const post of posts) {
    const date = new Date(2026, 2, post.day, post.hour, 0, 0);
    insert.run(post.text, date.getTime(), Date.now());
    added++;
  }

  return { success: true, added, total: db.prepare('SELECT COUNT(*) as c FROM scheduled_posts WHERE posted = 0').get().c };
}
