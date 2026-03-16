/**
 * poster.js — X (Twitter) auto-poster for PriceWatchHQ
 * Posts scheduled content from the posts queue.
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

/**
 * Post a tweet. Returns the tweet ID on success.
 */
export async function postTweet(text) {
  const { data } = await getTwitterClient().v2.tweet(text);
  return data.id;
}

/**
 * Get the next scheduled post that hasn't been posted yet.
 */
export function getNextPost() {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM scheduled_posts
    WHERE posted = 0 AND scheduled_for <= strftime('%s','now') * 1000
    ORDER BY scheduled_for ASC
    LIMIT 1
  `).get();
}

/**
 * Mark a post as posted.
 */
export function markPosted(id, tweetId) {
  const db = getDb();
  db.prepare(`
    UPDATE scheduled_posts SET posted = 1, tweet_id = ?, posted_at = ? WHERE id = ?
  `).run(tweetId, Date.now(), id);
}

/**
 * Schedule a post for a specific time (ms timestamp).
 */
export function schedulePost(text, scheduledFor) {
  const db = getDb();
  db.prepare(`
    INSERT INTO scheduled_posts (text, scheduled_for, posted, created_at)
    VALUES (?, ?, 0, ?)
  `).run(text, scheduledFor, Date.now());
}

/**
 * Run the poster — called by the scheduler.
 * Checks for due posts and sends them.
 */
export async function runPoster() {
  const post = getNextPost();
  if (!post) return;

  try {
    const tweetId = await postTweet(post.text);
    markPosted(post.id, tweetId);
    console.log(`[poster] Posted tweet ${tweetId}: ${post.text.slice(0, 50)}...`);
  } catch (err) {
    console.error(`[poster] Failed to post tweet:`, err.message);
  }
}
