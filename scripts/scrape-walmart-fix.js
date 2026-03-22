/**
 * One-time script to scrape all Walmart URLs and populate prices in the DB.
 * Run: node scripts/scrape-walmart-fix.js
 */
import 'dotenv/config';
import db from '../src/db.js';
import { scrapeWalmartViaSearchPage } from '../src/scraper-retail.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const urls = db.prepare("SELECT * FROM watched_urls WHERE url LIKE '%walmart%'").all();
  console.log(`Found ${urls.length} Walmart URLs to scrape.\n`);

  const results = [];

  for (const item of urls) {
    console.log(`[${results.length + 1}/${urls.length}] Scraping: ${item.label || item.url}`);
    console.log(`  URL: ${item.url}`);

    try {
      const data = await scrapeWalmartViaSearchPage(item.url);

      if (data && data.price) {
        console.log(`  ✓ Price: $${data.price}, Stock: ${data.stockStatus}`);

        // Update watched_urls
        db.prepare(
          "UPDATE watched_urls SET last_price=?, last_stock_status=?, last_checked_at=datetime('now'), fail_count=0, url_status='active' WHERE id=?"
        ).run(data.price, data.stockStatus, item.id);

        // Insert into price_history
        db.prepare(
          "INSERT INTO price_history (watched_url_id, price, recorded_at) VALUES (?,?,datetime('now'))"
        ).run(item.id, data.price);

        results.push({ id: item.id, label: item.label, price: data.price, stock: data.stockStatus, success: true });
      } else {
        console.log(`  ✗ No price returned — resetting last_checked_at for scheduler retry`);
        db.prepare("UPDATE watched_urls SET last_checked_at=NULL WHERE id=? AND last_price IS NULL").run(item.id);
        results.push({ id: item.id, label: item.label, price: null, stock: null, success: false });
      }
    } catch (err) {
      console.log(`  ✗ Error: ${err.message}`);
      db.prepare("UPDATE watched_urls SET last_checked_at=NULL WHERE id=? AND last_price IS NULL").run(item.id);
      results.push({ id: item.id, label: item.label, price: null, stock: null, success: false, error: err.message });
    }

    // 2-second delay between scrapes
    if (results.length < urls.length) {
      console.log(`  Waiting 2s...\n`);
      await sleep(2000);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SCRAPE SUMMARY');
  console.log('='.repeat(60));

  const succeeded = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`\nSucceeded: ${succeeded.length}/${results.length}`);
  for (const r of succeeded) {
    console.log(`  [${r.id}] ${r.label} — $${r.price} (${r.stock})`);
  }

  if (failed.length) {
    console.log(`\nFailed: ${failed.length}/${results.length}`);
    for (const r of failed) {
      console.log(`  [${r.id}] ${r.label} — ${r.error || 'no price returned'}`);
    }
  }

  // Final DB state
  console.log('\n' + '='.repeat(60));
  console.log('FINAL DB STATE — ALL WALMART ITEMS');
  console.log('='.repeat(60));
  const final = db.prepare("SELECT id, label, last_price, last_stock_status, last_checked_at, url_status FROM watched_urls WHERE url LIKE '%walmart%'").all();
  for (const row of final) {
    console.log(`  [${row.id}] ${row.label} — $${row.last_price} | ${row.last_stock_status} | checked: ${row.last_checked_at} | status: ${row.url_status}`);
  }
}

main().catch(console.error);
