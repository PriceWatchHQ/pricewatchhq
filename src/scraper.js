import { load } from 'cheerio';
import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { scrapePriceAndStockHeadless } from './scraper-headless.js';

// DataImpulse residential proxy
const PROXY_URL = process.env.PROXY_URL || null;
const proxyAgent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : null;

const PRICE_SELECTORS = [
  '.price',
  '[class*="price"]',
  '[itemprop="price"]',
];

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Fetch a page and extract the first price found using common selectors.
 * Returns the numeric price or null if nothing matched.
 */
export async function scrapePrice(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    timeout: 15_000,
    ...(proxyAgent ? { agent: proxyAgent } : {}),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const $ = load(html);

  for (const selector of PRICE_SELECTORS) {
    const el = $(selector).first();
    if (!el.length) continue;

    // Try the "content" attribute first (common on itemprop elements)
    const raw = el.attr('content') || el.text();
    const price = parsePrice(raw);
    if (price !== null) return price;
  }

  return null;
}

/**
 * Extract stock availability status from a page.
 * Returns 'in_stock', 'out_of_stock', or null if detection fails.
 */
export async function scrapeStockStatus(url, existingHtml) {
  let html = existingHtml;
  if (!html) {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 15_000,
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    }
    html = await res.text();
  }

  const $ = load(html);

  // Check structured data (schema.org availability)
  const availMeta = $('[itemprop="availability"]');
  if (availMeta.length) {
    const val = (availMeta.attr('href') || availMeta.attr('content') || availMeta.text()).toLowerCase();
    if (val.includes('instock') || val.includes('in_stock')) return 'in_stock';
    if (val.includes('outofstock') || val.includes('out_of_stock')) return 'out_of_stock';
  }

  // Check common stock-related selectors and text patterns
  const stockSelectors = [
    '#availability',
    '[class*="avail"]',
    '[class*="stock"]',
    '[id*="stock"]',
    '[data-availability]',
  ];

  for (const selector of stockSelectors) {
    const el = $(selector).first();
    if (!el.length) continue;
    const text = (el.attr('data-availability') || el.text()).toLowerCase().trim();
    if (!text) continue;

    if (/out of stock|sold out|unavailable|currently unavailable|not available/i.test(text)) {
      return 'out_of_stock';
    }
    if (/in stock|in-stock|available|add to cart|ships from/i.test(text)) {
      return 'in_stock';
    }
  }

  // Check for common "Add to Cart" buttons as a stock signal
  const cartBtn = $('button, input[type="submit"], [role="button"]').filter(function () {
    const t = $(this).text().toLowerCase();
    return t.includes('add to cart') || t.includes('add to basket') || t.includes('buy now');
  });
  if (cartBtn.length) return 'in_stock';

  return null;
}

/**
 * Fetch a page and extract both price and stock status in a single request.
 * Returns { price, stockStatus }.
 */
export async function scrapePriceAndStock(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    timeout: 15_000,
    ...(proxyAgent ? { agent: proxyAgent } : {}),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const $ = load(html);

  // Extract price
  let price = null;
  for (const selector of PRICE_SELECTORS) {
    const el = $(selector).first();
    if (!el.length) continue;
    const raw = el.attr('content') || el.text();
    price = parsePrice(raw);
    if (price !== null) break;
  }

  // Extract stock status (reuse the html we already fetched)
  const stockStatus = await scrapeStockStatus(url, html);

  return { price, stockStatus };
}

/**
 * Try the fast HTTP scraper first; if price is null, fall back to headless browser.
 * Returns { price, stockStatus }.
 */
export async function scrapePriceAndStockWithFallback(url) {
  const httpResult = await scrapePriceAndStock(url);

  if (httpResult.price !== null) {
    console.log(`[scraper] HTTP scraper succeeded for ${url}`);
    return httpResult;
  }

  console.log(`[scraper] HTTP scraper returned no price for ${url}, trying headless browser...`);
  try {
    const headlessResult = await scrapePriceAndStockHeadless(url);
    console.log(`[scraper] Headless scraper result for ${url}: price=${headlessResult.price}, stock=${headlessResult.stockStatus}`);
    return {
      price: headlessResult.price,
      stockStatus: headlessResult.stockStatus ?? httpResult.stockStatus,
    };
  } catch (err) {
    console.error(`[scraper] Headless scraper failed for ${url}:`, err.message);
    return httpResult;
  }
}

/**
 * Strip currency symbols / commas and parse to a float.
 */
function parsePrice(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.,]/g, '').replace(/,/g, '');
  const num = parseFloat(cleaned);
  // Sanity check: prices must be between $0.01 and $100,000
  if (!Number.isFinite(num) || num <= 0 || num > 100000) return null;
  return num;
}
