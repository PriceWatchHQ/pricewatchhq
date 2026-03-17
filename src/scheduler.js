import cron from 'node-cron';
import db from './db.js';
import { scrapePrice } from './scraper.js';
import { runPoster } from './poster.js';
import { sendPriceAlert } from './mailer.js';
import { PLAN_LIMITS } from './plans.js';

/**
 * Start the price-check cron job (every 15 minutes).
 * Respects each user's plan check frequency before scraping.
 */
export function startScheduler() {
  // Run every 15 minutes; each URL is checked only when its plan allows
  cron.schedule('*/15 * * * *', async () => {
    console.log(`[scheduler] Price check started at ${new Date().toISOString()}`);

    const urls = db.prepare('SELECT * FROM watched_urls').all();
    const now = Date.now();

    for (const entry of urls) {
      try {
        // Get user plan to determine check frequency
        const user = entry.user_id
          ? db.prepare('SELECT plan FROM users WHERE id = ?').get(entry.user_id)
          : null;
        const plan = user?.plan || 'free';
        const freqMinutes = PLAN_LIMITS[plan]?.checkFreqMinutes ?? PLAN_LIMITS.free.checkFreqMinutes;
        const freqMs = freqMinutes * 60 * 1000;

        // Skip if not enough time has passed since last check
        if (entry.last_checked_at) {
          const lastChecked = new Date(entry.last_checked_at).getTime();
          if (now - lastChecked < freqMs) {
            continue;
          }
        }

        const price = await scrapePrice(entry.url);

        if (price === null) {
          console.log(`[scheduler] No price found for ${entry.url}`);
          continue;
        }

        // Log to price_history
        db.prepare(
          'INSERT INTO price_history (watched_url_id, price) VALUES (?, ?)'
        ).run(entry.id, price);

        // Detect change and send alert
        if (entry.last_price !== null && price !== entry.last_price) {
          const direction = price < entry.last_price ? 'DROPPED' : 'INCREASED';
          console.log(
            `[alert] Price ${direction} for "${entry.label || entry.url}": ` +
            `$${entry.last_price} → $${price}`
          );

          // Get user email and send alert
          if (entry.user_id) {
            const userWithEmail = db.prepare('SELECT email FROM users WHERE id = ?').get(entry.user_id);
            if (userWithEmail?.email) {
              sendPriceAlert({
                to: userWithEmail.email,
                label: entry.label,
                url: entry.url,
                oldPrice: entry.last_price,
                newPrice: price,
              }).catch(err => console.error('[mailer] Failed to send alert:', err.message));
            }
          }
        }

        // Update last_price
        db.prepare(
          'UPDATE watched_urls SET last_price = ?, last_checked_at = datetime(\'now\') WHERE id = ?'
        ).run(price, entry.id);
      } catch (err) {
        console.error(`[scheduler] Error scraping ${entry.url}:`, err.message);
      }
    }

    console.log(`[scheduler] Price check complete.`);
  });

  console.log('[scheduler] Price check scheduled (every 15 min, respecting plan frequencies)');

  // Check for scheduled X posts every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    await runPoster();
  });

  console.log('[scheduler] X poster scheduled (every 15 min).');
}
