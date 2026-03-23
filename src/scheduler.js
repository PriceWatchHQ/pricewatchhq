import cron from 'node-cron';
import db from './db.js';
import { scrapePrice, scrapePriceAndStock, scrapePriceAndStockWithFallback } from './scraper.js';
import { isRetailUrl, scrapePriceAndStockRetail } from './scraper-retail.js';
import { runPoster } from './poster.js';
import { runEngager } from './engager.js';
import { sendPriceAlert, sendSlackAlert, sendSmsAlert, sendStockAlert, sendSlackStockAlert, sendSmsStockAlert } from './mailer.js';
import { PLAN_LIMITS } from './plans.js';

/**
 * Start the price-check cron job (every 15 minutes).
 * Respects each user's plan check frequency before scraping.
 */
// Max concurrent scrapes — keeps Railway CPU/memory healthy
// HTTP-only scrapes are cheap; Playwright/headless scrapes are heavy
const MAX_CONCURRENT_HTTP = 10;
const MAX_CONCURRENT_BROWSER = 5;

/**
 * Run an array of async tasks with a concurrency limit.
 */
async function runWithConcurrency(tasks, limit) {
  const results = [];
  const executing = new Set();
  for (const task of tasks) {
    const p = Promise.resolve().then(task).finally(() => executing.delete(p));
    executing.add(p);
    results.push(p);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.allSettled(results);
}

export function startScheduler() {
  // Run every 15 minutes; each URL is checked only when its plan allows
  cron.schedule('*/15 * * * *', async () => {
    console.log(`[scheduler] Price check started at ${new Date().toISOString()}`);

    const urls = db.prepare('SELECT * FROM watched_urls').all();
    const now = Date.now();

    // Separate URLs into browser-required vs HTTP-only for appropriate concurrency limits
    const browserUrls = [];
    const httpUrls = [];

    for (const entry of urls) {
      const user = entry.user_id
        ? db.prepare('SELECT plan FROM users WHERE id = ?').get(entry.user_id)
        : null;
      const plan = user?.plan || 'free';
      const freqMinutes = PLAN_LIMITS[plan]?.checkFreqMinutes ?? PLAN_LIMITS.free.checkFreqMinutes;
      const freqMs = freqMinutes * 60 * 1000;

      if (entry.last_checked_at) {
        const lastChecked = new Date(entry.last_checked_at).getTime();
        if (now - lastChecked < freqMs) continue;
      }

      const useHeadless = PLAN_LIMITS[plan]?.headlessScraper === true;
      const usePlaywright = PLAN_LIMITS[plan]?.playwrightScraper === true;
      const needsBrowser = isRetailUrl(entry.url) || useHeadless;

      if (needsBrowser) {
        browserUrls.push({ entry, plan, useHeadless, usePlaywright });
      } else {
        httpUrls.push({ entry, plan, useHeadless, usePlaywright });
      }
    }

    console.log(`[scheduler] Checking ${httpUrls.length} HTTP + ${browserUrls.length} browser URLs`);

    // Run HTTP tasks at higher concurrency, browser at lower
    const httpTasks = httpUrls.map(item => () => processUrl(item));
    const browserTasks = browserUrls.map(item => () => processUrl(item));

    await Promise.all([
      runWithConcurrency(httpTasks, MAX_CONCURRENT_HTTP),
      runWithConcurrency(browserTasks, MAX_CONCURRENT_BROWSER),
    ]);

    console.log(`[scheduler] Price check complete.`);
  });

  console.log('[scheduler] Price check scheduled (every 15 min, respecting plan frequencies)');

  // Check for scheduled X posts every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    await runPoster();
  });

  console.log('[scheduler] X poster scheduled (every 15 min).');
}

async function processUrl({ entry, plan, useHeadless, usePlaywright }) {
  try {
        // Retail URLs (Walmart, Best Buy, Target) always use the retail scraper
        // regardless of plan — plain HTTP never works on these sites
        let price, stockStatus;
        if (isRetailUrl(entry.url)) {
          ({ price, stockStatus } = await scrapePriceAndStockRetail(entry.url));
        } else if (useHeadless) {
          ({ price, stockStatus } = await scrapePriceAndStockWithFallback(entry.url, usePlaywright));
        } else {
          ({ price, stockStatus } = await scrapePriceAndStock(entry.url));
        }

        if (price === null && stockStatus === null) {
          const newFailCount = (entry.fail_count || 0) + 1;
          console.log(`[scheduler] No price or stock found for ${entry.url} (fail ${newFailCount})`);
          // Retail URLs (Walmart, Best Buy, Target) get bot-blocked frequently — never mark unavailable,
          // just keep retrying with last known price still displayed
          const isRetail = /walmart\.com|bestbuy\.com|target\.com/i.test(entry.url);
          if (!isRetail && newFailCount >= 5) {
            db.prepare(
              `UPDATE watched_urls SET fail_count = ?, url_status = 'unavailable', last_checked_at = datetime('now') WHERE id = ?`
            ).run(newFailCount, entry.id);
            console.log(`[scheduler] Marked ${entry.url} as unavailable after ${newFailCount} failures`);
          } else {
            // For retail URLs or non-retail under threshold: just increment fail count, keep active
            db.prepare(
              `UPDATE watched_urls SET fail_count = ?, url_status = 'active', last_checked_at = datetime('now') WHERE id = ?`
            ).run(newFailCount, entry.id);
          }
          return;
        }

        // Successful scrape — reset fail count and ensure status is active
        db.prepare(
          `UPDATE watched_urls SET fail_count = 0, url_status = 'active' WHERE id = ? AND (fail_count > 0 OR url_status != 'active')`
        ).run(entry.id);

        // Log price to price_history
        if (price !== null) {
          db.prepare(
            'INSERT INTO price_history (watched_url_id, price) VALUES (?, ?)'
          ).run(entry.id, price);
        }

        // Log stock status to stock_history
        if (stockStatus !== null) {
          db.prepare(
            'INSERT INTO stock_history (watched_url_id, stock_status) VALUES (?, ?)'
          ).run(entry.id, stockStatus);
        }

        // Get user for alerts
        let alertUser = null;
        if (entry.user_id) {
          alertUser = db.prepare(
            'SELECT email, plan, phone_number, slack_webhook_url FROM users WHERE id = ?'
          ).get(entry.user_id);
        }
        const alertPlan = alertUser?.plan || 'free';

        // Detect price change and send alert
        if (price !== null && entry.last_price !== null && price !== entry.last_price) {
          const direction = price < entry.last_price ? 'DROPPED' : 'INCREASED';
          console.log(
            `[alert] Price ${direction} for "${entry.label || entry.url}": ` +
            `$${entry.last_price} → $${price}`
          );

          if (alertUser?.email) {
            const alertArgs = {
              label: entry.label,
              url: entry.url,
              oldPrice: entry.last_price,
              newPrice: price,
            };

            // All plans: email
            sendPriceAlert({ to: alertUser.email, ...alertArgs })
              .catch(err => console.error('[mailer] Failed to send email alert:', err.message));

            // Pro+: SMS
            if ((alertPlan === 'pro' || alertPlan === 'business') && alertUser.phone_number) {
              sendSmsAlert({ to: alertUser.phone_number, ...alertArgs })
                .catch(err => console.error('[mailer] Failed to send SMS alert:', err.message));
            }

            // Business: Slack
            if (alertPlan === 'business' && alertUser.slack_webhook_url) {
              sendSlackAlert({ webhookUrl: alertUser.slack_webhook_url, ...alertArgs })
                .catch(err => console.error('[mailer] Failed to send Slack alert:', err.message));
            }
          }
        }

        // Detect stock status change and send alert
        if (stockStatus !== null && entry.last_stock_status !== null && stockStatus !== entry.last_stock_status) {
          console.log(
            `[alert] Stock changed for "${entry.label || entry.url}": ` +
            `${entry.last_stock_status} → ${stockStatus}`
          );

          if (alertUser?.email) {
            const stockArgs = {
              label: entry.label,
              url: entry.url,
              oldStatus: entry.last_stock_status,
              newStatus: stockStatus,
            };

            // All plans: email
            sendStockAlert({ to: alertUser.email, ...stockArgs })
              .catch(err => console.error('[mailer] Failed to send stock email alert:', err.message));

            // Pro+: SMS
            if ((alertPlan === 'pro' || alertPlan === 'business') && alertUser.phone_number) {
              sendSmsStockAlert({ to: alertUser.phone_number, ...stockArgs })
                .catch(err => console.error('[mailer] Failed to send stock SMS alert:', err.message));
            }

            // Business: Slack
            if (alertPlan === 'business' && alertUser.slack_webhook_url) {
              sendSlackStockAlert({ webhookUrl: alertUser.slack_webhook_url, ...stockArgs })
                .catch(err => console.error('[mailer] Failed to send stock Slack alert:', err.message));
            }
          }
        }

        // Update last_price and last_stock_status
        db.prepare(
          `UPDATE watched_urls SET
            last_price = COALESCE(?, last_price),
            last_stock_status = COALESCE(?, last_stock_status),
            last_checked_at = datetime('now')
          WHERE id = ?`
        ).run(price, stockStatus, entry.id);
  } catch (err) {
    console.error(`[scheduler] Error scraping ${entry.url}:`, err.message);
  }
}
