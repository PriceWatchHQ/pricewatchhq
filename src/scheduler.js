import cron from 'node-cron';
import db from './db.js';
import { scrapePrice } from './scraper.js';
import { runPoster } from './poster.js';

/**
 * Start the hourly price-check cron job.
 * Iterates every watched URL, scrapes the current price,
 * logs it to price_history, and alerts on changes.
 */
export function startScheduler() {
  // Run every hour at minute 0
  cron.schedule('0 * * * *', async () => {
    console.log(`[scheduler] Price check started at ${new Date().toISOString()}`);

    const urls = db.prepare('SELECT * FROM watched_urls').all();

    for (const entry of urls) {
      try {
        const price = await scrapePrice(entry.url);

        if (price === null) {
          console.log(`[scheduler] No price found for ${entry.url}`);
          continue;
        }

        // Log to price_history
        db.prepare(
          'INSERT INTO price_history (watched_url_id, price) VALUES (?, ?)'
        ).run(entry.id, price);

        // Detect change
        if (entry.last_price !== null && price !== entry.last_price) {
          const direction = price < entry.last_price ? 'DROPPED' : 'INCREASED';
          console.log(
            `[alert] Price ${direction} for "${entry.label || entry.url}": ` +
            `$${entry.last_price} → $${price}`
          );
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

  console.log('[scheduler] Hourly price check scheduled.');

  // Check for scheduled X posts every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    await runPoster();
  });

  console.log('[scheduler] X poster scheduled (every 15 min).');
}
