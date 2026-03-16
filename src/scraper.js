import { load } from 'cheerio';
import fetch from 'node-fetch';

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
 * Strip currency symbols / commas and parse to a float.
 */
function parsePrice(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.,]/g, '').replace(/,/g, '');
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
}
