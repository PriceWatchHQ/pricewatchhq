/**
 * Quick smoke test for scraper fixes:
 * - Best Buy /product/ URL format
 * - Generic store support (JSON-LD + expanded selectors)
 */
import { scrapePriceAndStock } from './src/scraper.js';

const TEST_URLS = [
  // Best Buy /product/ URL — should fall through to generic scraper
  'https://www.bestbuy.com/product/logitech-m720-triathlon-wireless-optical-mouse-wireless-black/J7H7ZYCZ7V',
  // Home Depot — JSON-LD structured data
  'https://www.homedepot.com/p/DEWALT-20V-MAX-XR-Lithium-Ion-Cordless-Brushless-2-Speed-1-2-in-Hammer-Drill-Driver-Kit-with-Two-5-0-Ah-Batteries-and-Charger-DCD998W1/327457282',
  // Scheels
  'https://www.scheels.com/p/84382914305',
  // GameStop
  'https://www.gamestop.com/consoles-hardware/nintendo-switch/nintendo-switch-consoles/products/nintendo-switch---mario-kart-8-deluxe-bundle/407182.html',
];

async function runTests() {
  for (const url of TEST_URLS) {
    const storeName = new URL(url).hostname.replace('www.', '');
    console.log(`\n--- Testing ${storeName} ---`);
    console.log(`URL: ${url.slice(0, 80)}...`);

    try {
      const result = await scrapePriceAndStock(url);
      console.log(`Result: price=${result.price}, stock=${result.stockStatus}`);
      if (result.price !== null) {
        console.log(`✓ SUCCESS — $${result.price}`);
      } else {
        console.log(`✗ No price found (may need browser fallback)`);
      }
    } catch (err) {
      console.log(`✗ ERROR: ${err.message}`);
    }
  }
}

runTests();
