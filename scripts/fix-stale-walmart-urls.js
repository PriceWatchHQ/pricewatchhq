/**
 * One-time script: find current valid Walmart URLs for 8 stale/delisted items
 * and update the DB with new URLs, prices, and stock status.
 *
 * Run: node scripts/fix-stale-walmart-urls.js
 */
import 'dotenv/config';
import { get as wreqGet } from 'wreq-js';
import db from '../src/db.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PROXY_URL = process.env.PROXY_URL || null;

const ITEMS = [
  { id: 59, search: 'Fujifilm Instax Mini 12 Camera' },
  { id: 73, search: 'PlayStation 5 DualSense Wireless Controller' },
  { id: 76, search: 'GoPro HERO11 Black' },
  { id: 77, search: 'Apple MacBook Air M2', newLabel: '💻 MacBook Air M2 - Walmart' },
  { id: 78, search: 'TCL 55 inch QLED 4K Smart TV' },
  { id: 79, search: 'Xbox Series S Console' },
  { id: 80, search: 'Sony WH-1000XM5 Wireless Noise Canceling Headphones' },
  { id: 81, search: 'Kasa Smart Plug WiFi' },
];

async function findWalmartUrl(productName) {
  const searchTerm = encodeURIComponent(productName);
  const opts = {
    browser: 'chrome_131',
    os: 'windows',
    headers: { 'accept-language': 'en-US,en;q=0.9' },
  };
  if (PROXY_URL) opts.proxy = PROXY_URL;
  const res = await wreqGet(`https://www.walmart.com/search?q=${searchTerm}`, opts);
  if (!res.ok) {
    console.log(`    HTTP ${res.status}`);
    return null;
  }
  const html = await res.text();
  if (html.includes('Robot or human') || html.length < 50000) {
    console.log(`    Blocked or too short (${html.length} chars)`);
    return null;
  }

  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) {
    console.log('    No __NEXT_DATA__ found');
    return null;
  }

  const data = JSON.parse(match[1]);
  const items = data?.props?.pageProps?.initialData?.searchResult?.itemStacks?.[0]?.items || [];

  // Filter out refurbished/restored/pre-owned and ad placeholders
  const realItems = items.filter(
    it => it.usItemId && !['refurb', 'restored', 'pre-owned'].some(w => (it.name || '').toLowerCase().includes(w))
  );

  if (!realItems.length) {
    console.log(`    No real items found (${items.length} total items in results)`);
    return null;
  }

  const item = realItems[0];
  const url = `https://www.walmart.com${item.canonicalUrl || '/ip/' + item.usItemId}`;
  const price = item.priceInfo?.currentPrice?.price || item.price || null;
  const stockStatus = item.isOutOfStock ? 'out_of_stock' : (price ? 'in_stock' : null);

  return { url, price, stockStatus, itemId: item.usItemId, name: item.name };
}

async function main() {
  console.log(`Processing ${ITEMS.length} stale Walmart items...\n`);

  const results = [];

  for (const item of ITEMS) {
    console.log(`[${results.length + 1}/${ITEMS.length}] Searching: "${item.search}" (DB id=${item.id})`);

    try {
      const found = await findWalmartUrl(item.search);

      if (found && found.url) {
        console.log(`  ✓ Found: ${found.name}`);
        console.log(`    URL: ${found.url}`);
        console.log(`    Price: $${found.price}, Stock: ${found.stockStatus}`);

        // Update URL, price, stock status, reset fail count
        db.prepare(
          "UPDATE watched_urls SET url=?, last_price=?, last_stock_status=?, last_checked_at=datetime('now'), fail_count=0, url_status='active' WHERE id=?"
        ).run(found.url, found.price, found.stockStatus, item.id);

        // Update label if needed (MacBook M1 → M2)
        if (item.newLabel) {
          db.prepare("UPDATE watched_urls SET label=? WHERE id=?").run(item.newLabel, item.id);
          console.log(`    Label updated to: ${item.newLabel}`);
        }

        // Insert price history if we got a price
        if (found.price) {
          db.prepare(
            "INSERT INTO price_history (watched_url_id, price, recorded_at) VALUES (?,?,datetime('now'))"
          ).run(item.id, found.price);
        }

        results.push({ ...item, found, success: true });
      } else {
        console.log('  ✗ No valid result found');
        results.push({ ...item, found: null, success: false });
      }
    } catch (err) {
      console.log(`  ✗ Error: ${err.message}`);
      results.push({ ...item, found: null, success: false, error: err.message });
    }

    // Wait 3s between searches to avoid rate limiting
    if (results.length < ITEMS.length) {
      console.log('  Waiting 3s...\n');
      await sleep(3000);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  const succeeded = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`\nSucceeded: ${succeeded.length}/${results.length}`);
  for (const r of succeeded) {
    console.log(`  [${r.id}] ${r.found.name} — $${r.found.price} (${r.found.stockStatus})`);
    console.log(`         ${r.found.url}`);
  }

  if (failed.length) {
    console.log(`\nFailed: ${failed.length}/${results.length}`);
    for (const r of failed) {
      console.log(`  [${r.id}] "${r.search}" — ${r.error || 'no result'}`);
    }
  }
}

main().catch(console.error);
