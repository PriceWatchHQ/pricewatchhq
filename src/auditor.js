/**
 * Daily Price Auditor — re-scrapes every watched URL and corrects bad prices.
 * 
 * When the auditor finds a price different from what's stored, it:
 * 1. Updates last_price with the verified correct price
 * 2. Deletes today's price_history entries for that URL (they were from bad scrapes)
 * 3. Inserts one clean history entry with the audited price
 * 
 * This prevents the dashboard from showing misleading "▼ Down $50" badges
 * when the change was really just a scraper error being corrected.
 */

import db from './db.js';
import { isRetailUrl, scrapePriceAndStockRetail } from './scraper-retail.js';
import { isSpecialtyUrl, scrapePriceAndStockSpecialty } from './scraper-specialty.js';
import { scrapePriceAndStock } from './scraper.js';

const CONCURRENCY = 3; // Run 3 at a time to avoid overwhelming ZenRows
const DELAY_MS = 2000; // 2s between batches

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function scrapeUrl(url) {
  if (isSpecialtyUrl(url)) return scrapePriceAndStockSpecialty(url);
  if (isRetailUrl(url)) return scrapePriceAndStockRetail(url);
  return scrapePriceAndStock(url);
}

async function runAudit() {
  console.log('[auditor] Starting daily price audit...');
  const urls = db.prepare('SELECT * FROM watched_urls WHERE url_status = ?').all('active');
  console.log(`[auditor] Auditing ${urls.length} URLs`);

  let corrected = 0;
  let confirmed = 0;
  let failed = 0;

  // Process in batches of CONCURRENCY
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (entry) => {
      try {
        const { price, stockStatus } = await scrapeUrl(entry.url);
        
        if (price === null) {
          console.log(`[auditor] ✗ No price for ${entry.label || entry.url.slice(0, 50)}`);
          failed++;
          return;
        }

        const priceChanged = entry.last_price !== null && Math.abs(price - entry.last_price) > 0.01;
        
        if (priceChanged) {
          console.log(`[auditor] ✎ Correcting ${entry.label}: $${entry.last_price} → $${price}`);
          
          // Delete today's price_history entries (likely from bad scrapes)
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          db.prepare(
            "DELETE FROM price_history WHERE watched_url_id = ? AND recorded_at >= datetime('now', 'start of day')"
          ).run(entry.id);
          
          // Update the stored price
          db.prepare(
            "UPDATE watched_urls SET last_price=?, last_stock_status=?, last_checked_at=datetime('now'), fail_count=0 WHERE id=?"
          ).run(price, stockStatus || entry.last_stock_status, entry.id);
          
          // Insert one clean audited price_history entry
          db.prepare(
            "INSERT INTO price_history (watched_url_id, price, recorded_at) VALUES (?, ?, datetime('now'))"
          ).run(entry.id, price);
          
          corrected++;
        } else {
          // Price confirmed — just update stock status and timestamp
          db.prepare(
            "UPDATE watched_urls SET last_stock_status=?, last_checked_at=datetime('now'), fail_count=0 WHERE id=?"
          ).run(stockStatus || entry.last_stock_status, entry.id);
          console.log(`[auditor] ✓ Confirmed ${entry.label || entry.url.slice(0, 40)}: $${price}`);
          confirmed++;
        }
      } catch (err) {
        console.error(`[auditor] Error on ${entry.url.slice(0, 60)}:`, err.message?.slice(0, 80));
        failed++;
      }
    }));
    
    if (i + CONCURRENCY < urls.length) await sleep(DELAY_MS);
  }

  console.log(`[auditor] Done — confirmed: ${confirmed}, corrected: ${corrected}, failed: ${failed}`);
  return { confirmed, corrected, failed, total: urls.length };
}

export { runAudit };
