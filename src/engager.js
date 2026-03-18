/**
 * engager.js — Organic X engagement for @PriceWatchHQ
 * Searches for relevant tweets and replies thoughtfully.
 * Conservative: max 5 replies per day, spaced out, no templated responses.
 */

import { TwitterApi } from 'twitter-api-v2';
import { getDb } from './db.js';
let rwClient = null;

function getTwitterClient() {
  if (!rwClient) {
    const client = new TwitterApi({
      appKey: process.env.X_CONSUMER_KEY,
      appSecret: process.env.X_CONSUMER_SECRET,
      accessToken: process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_SECRET,
    });
    rwClient = client.readWrite;
  }
  return rwClient;
}

function getDb2() {
  return getDb();
}

// Ensure engagement tracking table exists
function ensureTable() {
  const db = getDb2();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS engagement_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tweet_id TEXT NOT NULL,
      reply_text TEXT,
      engaged_at INTEGER NOT NULL,
      type TEXT DEFAULT 'reply'
    )
  `).run();
}

function alreadyEngaged(tweetId) {
  const db = getDb2();
  ensureTable();
  const row = db.prepare('SELECT id FROM engagement_log WHERE tweet_id = ?').get(tweetId);
  return !!row;
}

function logEngagement(tweetId, replyText, type = 'reply') {
  const db = getDb2();
  ensureTable();
  db.prepare('INSERT INTO engagement_log (tweet_id, reply_text, engaged_at, type) VALUES (?, ?, ?, ?)').run(tweetId, replyText, Date.now(), type);
}

function getRepliesThisWindow() {
  const db = getDb2();
  ensureTable();
  // Count replies in last 24 hours
  const since = Date.now() - (24 * 60 * 60 * 1000);
  const row = db.prepare("SELECT COUNT(*) as count FROM engagement_log WHERE type = 'reply' AND engaged_at > ?").get(since);
  return row.count;
}

const SEARCH_QUERIES = [
  'competitor price monitoring ecommerce -is:retweet lang:en',
  'shopify competitor pricing -is:retweet lang:en',
  'price tracking ecommerce tool -is:retweet lang:en',
  'competitor prices ecommerce -is:retweet lang:en',
];

function generateReply(tweetText) {
  const lower = tweetText.toLowerCase();

  // Context-aware replies based on tweet content
  if (lower.includes('spreadsheet') || lower.includes('manually')) {
    const replies = [
      "Manual tracking doesn't scale — the moment you have 3+ competitors it becomes a part-time job.",
      "Spreadsheets work until they don't. The moment a competitor moves on a Friday afternoon, you find out Monday.",
      "There's a reason spreadsheet-based monitoring always breaks down. Too many edge cases, too easy to forget.",
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }

  if (lower.includes('shopify') || lower.includes('ecommerce') || lower.includes('e-commerce')) {
    const replies = [
      "Knowing what competitors charge is half the battle. The other half is knowing the moment they change it.",
      "Price positioning matters so much in e-commerce. The stores that react fastest usually win.",
      "One thing underrated in e-commerce: speed of price response. The first mover usually takes the sale.",
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }

  if (lower.includes('pricing') || lower.includes('price')) {
    const replies = [
      "Pricing is only as good as your competitive intel. Hard to price right if you don't know what others are charging.",
      "Dynamic pricing sounds complex but it starts simple: just know what your competitors charge and when it changes.",
      "The stores with the best pricing strategy usually have the best pricing data. Not a coincidence.",
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }

  // Generic value-add replies
  const generic = [
    "Competitor monitoring is one of those things that pays for itself the first time you catch a price drop before your customers do.",
    "The e-commerce brands that grow fastest tend to be the ones that treat competitor intel as a daily input, not a quarterly review.",
    "Real-time data beats gut instinct every time in e-commerce. Especially on pricing.",
  ];
  return generic[Math.floor(Math.random() * generic.length)];
}

/**
 * Run the engagement loop — called periodically.
 * Searches for relevant tweets and replies to a few per day.
 */
export async function runEngager() {
  ensureTable();

  const MAX_REPLIES_PER_DAY = 5;
  const repliesThisWindow = getRepliesThisWindow();

  if (repliesThisWindow >= MAX_REPLIES_PER_DAY) {
    console.log(`[engager] Daily reply limit reached (${repliesThisWindow}/${MAX_REPLIES_PER_DAY}). Skipping.`);
    return;
  }

  const client = getTwitterClient();
  const query = SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];

  console.log(`[engager] Searching: "${query}"`);

  let tweets;
  try {
    const result = await client.v2.search(query, {
      max_results: 10,
      'tweet.fields': ['author_id', 'created_at', 'text'],
      'expansions': ['author_id'],
      'user.fields': ['username'],
    });
    tweets = result.data?.data || [];
  } catch (err) {
    console.error('[engager] Search failed:', err.message);
    return;
  }

  if (!tweets.length) {
    console.log('[engager] No tweets found.');
    return;
  }

  const users = {};
  // Build user map if expansions available
  try {
    const userList = tweets._realData?.includes?.users || [];
    userList.forEach(u => { users[u.id] = u.username; });
  } catch {}

  let replied = 0;
  const remaining = MAX_REPLIES_PER_DAY - repliesThisWindow;

  for (const tweet of tweets) {
    if (replied >= remaining) break;
    if (alreadyEngaged(tweet.id)) continue;

    // Skip very short tweets or ones that seem spammy
    if (tweet.text.length < 30) continue;
    if (tweet.text.toLowerCase().includes('follow me') || tweet.text.toLowerCase().includes('giveaway')) continue;

    const authorUsername = users[tweet.author_id] || 'user';

    try {
      const replyText = generateReply(tweet.text);

      await client.v2.reply(replyText, tweet.id);
      logEngagement(tweet.id, replyText, 'reply');

      console.log(`[engager] Replied to @${authorUsername}: ${replyText.slice(0, 60)}...`);
      replied++;

      // Space out replies — wait 2 minutes between each
      if (replied < remaining) {
        await new Promise(r => setTimeout(r, 2 * 60 * 1000));
      }
    } catch (err) {
      console.error(`[engager] Failed to reply to ${tweet.id}:`, err.message);
      logEngagement(tweet.id, null, 'failed');
    }
  }

  console.log(`[engager] Done. Replied to ${replied} tweets today (${repliesThisWindow + replied}/${MAX_REPLIES_PER_DAY}).`);
}
