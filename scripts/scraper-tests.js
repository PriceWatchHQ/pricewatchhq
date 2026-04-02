/**
 * Scraper regression tests — runs against live URLs to verify correct behavior.
 * These tests catch the bugs we've been fixing manually:
 * - Target stock false-positive OOS (shipping vs pickup)
 * - Target wrong variant price (# fragment stripping)
 * - Home Depot regular price vs sale price
 * - ZenRows body text catching OOS from related products
 * 
 * Usage: node scripts/scraper-tests.js
 */

import '../src/scraper-retail.js'; // warm up imports
import { scrapePriceAndStockRetail } from '../src/scraper-retail.js';
import { scrapePriceAndStockSpecialty } from '../src/scraper-specialty.js';
import { scrapePriceAndStock } from '../src/scraper.js';

const TESTS = [
  // ---- Target ----
  {
    name: 'Target: in-stock item returns in_stock (not false OOS)',
    url: 'https://www.target.com/p/little-tikes-cozy-coupe/-/A-53594417',
    fn: scrapePriceAndStockRetail,
    assert: (r) => {
      if (r.price === null) throw new Error('No price returned');
      if (r.price < 10 || r.price > 200) throw new Error(`Price $${r.price} out of expected range $10-$200`);
      if (r.stockStatus === 'out_of_stock') throw new Error('Falsely marked out_of_stock — Target shipping/pickup bug');
    }
  },
  {
    name: 'Target: variant URL with ?preselect returns correct variant price',
    url: 'https://www.target.com/p/la-roche-posay-toleriane-double-repair-face-moisturizer-with-ceramide-and-niacinamide/-/A-94570668?preselect=51195618',
    fn: scrapePriceAndStockRetail,
    assert: (r) => {
      if (r.price === null) throw new Error('No price returned');
      // 3.38oz version should be $20-$30, not $10-$12 (which is the 1.35oz)
      if (r.price < 15) throw new Error(`Price $${r.price} too low — likely got wrong variant (1.35oz instead of 3.38oz)`);
    }
  },
  // ---- Home Depot ----
  {
    name: 'Home Depot: returns sale price not regular price',
    url: 'https://www.homedepot.com/p/DEWALT-20V-MAX-XR-Lithium-Ion-Electric-Cordless-18-Gauge-Brad-Nailer-Tool-Only-DCN680B/302029641',
    fn: scrapePriceAndStockSpecialty,
    assert: (r) => {
      if (r.price === null) throw new Error('No price returned');
      if (r.price > 400) throw new Error(`Price $${r.price} too high — likely got regular price instead of sale price`);
    }
  },
  // ---- Scheels ----
  {
    name: 'Scheels: returns price via JSON-LD',
    url: 'https://www.scheels.com/p/84382914305',
    fn: scrapePriceAndStock,
    assert: (r) => {
      if (r.price === null) throw new Error('No price returned — JSON-LD extraction broken');
      if (r.price < 50 || r.price > 500) throw new Error(`Price $${r.price} out of expected range for a scope`);
    }
  },
  // ---- Hobby Lobby ----
  {
    name: 'Hobby Lobby: returns price via __NEXT_DATA__',
    url: 'https://www.hobbylobby.com/art-supplies/art-sets/mixed-media-art-set---143-piece-set/p/80930712',
    fn: scrapePriceAndStockSpecialty,
    assert: (r) => {
      if (r.price === null) throw new Error('No price returned — __NEXT_DATA__ extraction broken');
      if (r.price < 20 || r.price > 200) throw new Error(`Price $${r.price} out of expected range $20-$200`);
      if (r.stockStatus === null) throw new Error('No stock status — inStock field missing from __NEXT_DATA__');
    }
  },
  // ---- Amazon ----
  {
    name: 'Amazon: returns price for Echo Spot',
    url: 'https://www.amazon.com/dp/B09B93ZDG4',
    fn: scrapePriceAndStockRetail,
    assert: (r) => {
      if (r.price === null) throw new Error('No price returned');
      if (r.price < 20 || r.price > 150) throw new Error(`Price $${r.price} out of expected range $20-$150`);
    }
  },
  // ---- Best Buy ----
  {
    name: 'Best Buy API: returns price for AirPods Pro',
    url: 'https://www.bestbuy.com/site/apple-airpods-pro-2nd-generation/6447382.p',
    fn: scrapePriceAndStockRetail,
    assert: (r) => {
      if (r.price === null) throw new Error('No price returned');
      if (r.price < 150 || r.price > 350) throw new Error(`Price $${r.price} out of range $150-$350`);
    }
  },
  // ---- Walmart ----
  {
    name: 'Walmart: returns price for Nintendo Switch OLED',
    url: 'https://www.walmart.com/ip/Nintendo-Switch-OLED-Model-w-White-Joy-Con/910582148',
    fn: scrapePriceAndStockRetail,
    assert: (r) => {
      if (r.price === null) throw new Error('No price returned');
      if (r.price < 200 || r.price > 500) throw new Error(`Price $${r.price} out of range $200-$500`);
    }
  },
];

let passed = 0;
let failed = 0;
const failures = [];

console.log(`\n🧪 Running ${TESTS.length} scraper regression tests...\n`);

for (const test of TESTS) {
  try {
    console.log(`  Testing: ${test.name}`);
    const result = await test.fn(test.url);
    test.assert(result);
    console.log(`  ✅ PASS — price=$${result.price} stock=${result.stockStatus}\n`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL — ${err.message}\n`);
    failures.push({ name: test.name, error: err.message });
    failed++;
  }
}

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${TESTS.length} tests`);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  ❌ ${f.name}: ${f.error}`));
}
console.log('');
process.exit(failed > 0 ? 1 : 0);
