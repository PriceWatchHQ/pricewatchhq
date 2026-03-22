import { scrapePriceAndStockRetail } from '../src/scraper-retail.js';
import { getDb } from '../src/db.js';

const db = getDb();
const urls = db.prepare("SELECT * FROM watched_urls WHERE url LIKE '%bestbuy%' AND last_price IS NULL").all();
console.log('Scraping', urls.length, 'BB URLs...\n');

for (const entry of urls) {
  try {
    const result = await scrapePriceAndStockRetail(entry.url);
    if (result && result.price !== null) {
      db.prepare("UPDATE watched_urls SET last_price = ?, last_stock_status = ?, last_checked_at = datetime('now') WHERE id = ?")
        .run(result.price, result.stockStatus, entry.id);
      console.log('✓', entry.label, ':', '$' + result.price, result.stockStatus);
    } else {
      console.log('✗', entry.label, ': no price returned');
    }
  } catch(e) {
    console.log('✗', entry.label, ':', e.message?.slice(0, 60));
  }
  // Small delay between requests
  await new Promise(r => setTimeout(r, 500));
}
console.log('\nDone');
