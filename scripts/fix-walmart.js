import { scrapePriceAndStockRetail } from '../src/scraper-retail.js';
import { getDb } from '../src/db.js';

const db = getDb();
const urls = db.prepare("SELECT * FROM watched_urls WHERE last_price IS NULL AND (url LIKE '%walmart%' OR url LIKE '%target%')").all();
console.log('Scraping', urls.length, 'Walmart/Target URLs...\n');

for (const entry of urls) {
  try {
    const result = await scrapePriceAndStockRetail(entry.url);
    if (result && result.price !== null) {
      db.prepare("UPDATE watched_urls SET last_price = ?, last_stock_status = ?, last_checked_at = datetime('now') WHERE id = ?")
        .run(result.price, result.stockStatus, entry.id);
      console.log('✓', entry.label, ':', '$' + result.price, result.stockStatus);
    } else {
      console.log('✗', entry.label, ': no price');
    }
  } catch(e) {
    console.log('✗', entry.label, ':', e.message?.slice(0, 60));
  }
  await new Promise(r => setTimeout(r, 800));
}
console.log('\nDone');
