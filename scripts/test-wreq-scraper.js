/**
 * Test the updated wreq-js generic scraper against various retail URLs.
 * Run: node scripts/test-wreq-scraper.js
 */
import { scrapePriceAndStock } from '../src/scraper.js';
import { scrapePriceAndStockPlaywright } from '../src/scraper-playwright.js';

const urls = [
  "https://www.homedepot.com/p/DEWALT-20V-MAX-XR-Lithium-Ion-Electric-Cordless-18-Gauge-Brad-Nailer-Tool-Only-DCN680B/302029641",
  "https://www.gamestop.com/toys-games/trading-cards/products/pokemon-trading-card-game-destined-rivals-booster-bundle/424446.html",
  "https://www.lowes.com/pd/Whirlpool-3-5-cu-ft-High-Efficiency-Top-Load-Washer-White-While-Supplies-Last/1000064061",
  "https://www.scheels.com/p/84382914305",
  "https://www.michaels.com/product/bandai-mg-gundam-verka-uc0093-mobile-suit-model-kit-10751365",
  "https://www.hobbylobby.com/art-supplies/art-sets/mixed-media-art-set---143-piece-set/p/80930712",
  "https://www.academy.com/p/asics-mens-gel-numbus-28-running-shoes",
];

const results = [];

for (const url of urls) {
  const domain = new URL(url).hostname.replace('www.', '');
  console.log(`\n--- ${domain} ---`);
  console.log(`URL: ${url}`);

  try {
    const result = await scrapePriceAndStock(url);
    console.log(`  wreq-js result: price=${result.price}, stock=${result.stockStatus}`);

    if (result.price !== null) {
      results.push({ domain, price: result.price, stock: result.stockStatus, method: 'wreq-js' });
    } else {
      // Try Playwright fallback
      console.log(`  wreq-js returned null price, trying Playwright fallback...`);
      try {
        const pwResult = await scrapePriceAndStockPlaywright(url);
        console.log(`  Playwright result: price=${pwResult.price}, stock=${pwResult.stockStatus}`);
        results.push({
          domain,
          price: pwResult.price,
          stock: pwResult.stockStatus,
          method: pwResult.price !== null ? 'playwright' : 'FAILED',
        });
      } catch (pwErr) {
        console.log(`  Playwright also failed: ${pwErr.message}`);
        results.push({ domain, price: null, stock: null, method: 'FAILED' });
      }
    }
  } catch (err) {
    console.log(`  Error: ${err.message}`);
    results.push({ domain, price: null, stock: null, method: 'FAILED' });
  }
}

console.log('\n\n=== SUMMARY ===');
console.table(results);
