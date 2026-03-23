import { load } from 'cheerio';
import { get as wreqGet } from 'wreq-js';
import { scrapePriceAndStockHeadless } from './scraper-headless.js';
import { scrapePriceAndStockPlaywright } from './scraper-playwright.js';
import { scrapePriceAndStockRetail, isRetailUrl } from './scraper-retail.js';

// DataImpulse residential proxy (passed to wreq-js when set)
const PROXY_URL = process.env.PROXY_URL || null;

const PRICE_SELECTORS = [
  '[itemprop="price"]',
  '[data-price]',
  '.price',
  '[class*="price"]',
  '[class*="Price"]',
  'span[class*="amount"]',
  '[data-testid*="price"]',
  '[data-testid*="Price"]',
  '[class*="product-price"]',
  '[class*="productPrice"]',
  '[class*="sale-price"]',
  '[class*="salePrice"]',
  '[class*="current-price"]',
  '[class*="currentPrice"]',
  '[class*="offer-price"]',
  '[class*="special-price"]',
];

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Fetch a page and extract the first price found using common selectors.
 * Returns the numeric price or null if nothing matched.
 */
export async function scrapePrice(url) {
  const res = await wreqGet(url, {
    browser: 'chrome_131',
    os: 'windows',
    headers: { 'accept-language': 'en-US,en;q=0.9' },
    ...(PROXY_URL ? { proxy: PROXY_URL } : {}),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const $ = load(html);

  // Try JSON-LD structured data first
  const jsonLdPrice = extractPriceFromJsonLd($);
  if (jsonLdPrice !== null) return jsonLdPrice;

  for (const selector of PRICE_SELECTORS) {
    const el = $(selector).first();
    if (!el.length) continue;

    // Try the "content" attribute first (common on itemprop elements)
    const raw = el.attr('content') || el.attr('data-price') || el.text();
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
    const res = await wreqGet(url, {
      browser: 'chrome_131',
      os: 'windows',
      headers: { 'accept-language': 'en-US,en;q=0.9' },
      ...(PROXY_URL ? { proxy: PROXY_URL } : {}),
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

  // For Amazon: use the buy-box availability element exclusively
  // (other selectors match unrelated page sections and produce false OOS)
  const isAmazon = url.includes('amazon.com');
  if (isAmazon) {
    // Add to Cart button = definitively in stock (main seller)
    const cartBtn = $('[id="add-to-cart-button"], [name="submit.add-to-cart"]').first();
    if (cartBtn.length && !cartBtn.attr('disabled')) return 'in_stock';

    // Check main buy box availability text
    const avail = $('#availability').first();
    let mainBuyBoxOOS = false;
    if (avail.length) {
      const text = avail.text().toLowerCase().trim();
      if (/in stock|in-stock|available|ships from|only \d+ left/i.test(text)) return 'in_stock';
      if (/out of stock|sold out|unavailable|currently unavailable|not available/i.test(text)) {
        mainBuyBoxOOS = true;
      }
    }

    // If main buy box is OOS, check for other sellers (3rd party / marketplace)
    if (mainBuyBoxOOS) {
      const otherSellers = $('#olp_feature_div, #moreBuyingChoices_feature_div, #buybox-see-all-buying-choices, #new-buybox').first();
      if (otherSellers.length && otherSellers.text().trim().length > 0) {
        return 'third_party'; // Main seller OOS but 3rd party sellers have stock
      }
      return 'out_of_stock';
    }

    return null;
  }

  // Non-Amazon: check stock-related selectors and text patterns
  // Use specific selectors first; avoid broad class matchers that cause false positives
  const stockSelectors = [
    '#availability',
    '[data-availability]',
    '[id*="stock"]',
    '[class*="availability"]',
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
  const res = await wreqGet(url, {
    browser: 'chrome_131',
    os: 'windows',
    headers: { 'accept-language': 'en-US,en;q=0.9' },
    ...(PROXY_URL ? { proxy: PROXY_URL } : {}),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();

  // Detect bot-block/captcha pages — bail early to avoid false data
  if (html.length < 20_000 && /captcha|robot|automated|unusual traffic|Type the characters/i.test(html)) {
    console.log(`[scraper] Bot-blocked (captcha) for ${url}, returning null`);
    return { price: null, stockStatus: null };
  }

  const $ = load(html);

  // Extract price — try JSON-LD structured data first (most reliable)
  let price = extractPriceFromJsonLd($);

  // Fall back to CSS selectors
  if (price === null) {
    for (const selector of PRICE_SELECTORS) {
      const el = $(selector).first();
      if (!el.length) continue;
      const raw = el.attr('content') || el.attr('data-price') || el.text();
      price = parsePrice(raw);
      if (price !== null) break;
    }
  }

  // Extract stock status (reuse the html we already fetched)
  const stockStatus = await scrapeStockStatus(url, html);

  return { price, stockStatus };
}

/**
 * Extract price from JSON-LD (schema.org) structured data embedded in the page.
 * Many retail sites (Home Depot, Lowe's, GameStop, Scheels, etc.) embed Product
 * schema with offers containing price info.
 */
function extractPriceFromJsonLd($) {
  const scripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    try {
      const data = JSON.parse($(scripts[i]).html());
      const price = extractPriceFromSchemaObject(data);
      if (price !== null) return price;
    } catch {
      // malformed JSON-LD, skip
    }
  }
  return null;
}

function extractPriceFromSchemaObject(obj) {
  if (!obj || typeof obj !== 'object') return null;

  // Handle arrays (some pages have multiple JSON-LD blocks in one script)
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const price = extractPriceFromSchemaObject(item);
      if (price !== null) return price;
    }
    return null;
  }

  // Look for Product or IndividualProduct types
  const type = obj['@type'];
  const isProduct = type === 'Product' || type === 'IndividualProduct' ||
    (Array.isArray(type) && (type.includes('Product') || type.includes('IndividualProduct')));

  if (isProduct) {
    // Try offers.price, offers[0].price, offers.lowPrice
    const offers = obj.offers;
    if (offers) {
      const offerList = Array.isArray(offers) ? offers : [offers];
      for (const offer of offerList) {
        const rawPrice = offer.price ?? offer.lowPrice ?? offer.highPrice;
        if (rawPrice != null) {
          const num = parseFloat(String(rawPrice).replace(/[^0-9.]/g, ''));
          if (Number.isFinite(num) && num > 0 && num <= 100000) return num;
        }
      }
    }
  }

  // Recurse into @graph
  if (obj['@graph']) {
    return extractPriceFromSchemaObject(obj['@graph']);
  }

  return null;
}

/**
 * Try the fast HTTP scraper first; if price is null, fall back to headless browser.
 * When usePlaywright is true, adds a Playwright stealth tier between HTTP and Puppeteer.
 * Fallback chain: HTTP → Retail stealth (if retail URL) → Playwright generic → Puppeteer headless.
 * Returns { price, stockStatus }.
 */
export async function scrapePriceAndStockWithFallback(url, usePlaywright = false) {
  const httpResult = await scrapePriceAndStock(url);

  if (httpResult.price !== null) {
    console.log(`[scraper] HTTP scraper succeeded for ${url}`);
    return httpResult;
  }

  // Retail-specific stealth scraper (Walmart, Best Buy, Target)
  if (usePlaywright && isRetailUrl(url)) {
    console.log(`[scraper] HTTP scraper returned no price for ${url}, trying retail stealth scraper...`);
    try {
      const retailResult = await scrapePriceAndStockRetail(url);
      console.log(`[scraper] Retail scraper result for ${url}: price=${retailResult.price}, stock=${retailResult.stockStatus}`);
      if (retailResult.price !== null) {
        return {
          price: retailResult.price,
          stockStatus: retailResult.stockStatus ?? httpResult.stockStatus,
        };
      }
    } catch (err) {
      console.error(`[scraper] Retail stealth scraper failed for ${url}:`, err.message);
    }
  }

  // Generic Playwright stealth fallback (pro/business plans, non-retail or retail fallback)
  if (usePlaywright) {
    console.log(`[scraper] Trying generic Playwright stealth for ${url}...`);
    try {
      const pwResult = await scrapePriceAndStockPlaywright(url);
      console.log(`[scraper] Playwright result for ${url}: price=${pwResult.price}, stock=${pwResult.stockStatus}`);
      if (pwResult.price !== null) {
        return {
          price: pwResult.price,
          stockStatus: pwResult.stockStatus ?? httpResult.stockStatus,
        };
      }
    } catch (err) {
      console.error(`[scraper] Playwright stealth failed for ${url}:`, err.message);
    }
  }

  // Puppeteer headless fallback
  console.log(`[scraper] Trying Puppeteer headless for ${url}...`);
  try {
    const headlessResult = await scrapePriceAndStockHeadless(url);
    console.log(`[scraper] Headless scraper result for ${url}: price=${headlessResult.price}, stock=${headlessResult.stockStatus}`);
    return {
      price: headlessResult.price,
      stockStatus: headlessResult.stockStatus ?? httpResult.stockStatus,
    };
  } catch (err) {
    console.error(`[scraper] Headless scraper failed for ${url}:`, err.message);
  }

  // ZenRows premium proxy fallback (tier 3) — last resort for bot-protected sites
  if (process.env.ZENROWS_KEY) {
    console.log(`[scraper] Trying ZenRows fallback for ${url}...`);
    try {
      const zenResult = await scrapeViaZenRows(url);
      if (zenResult.price !== null) {
        return {
          price: zenResult.price,
          stockStatus: zenResult.stockStatus ?? httpResult.stockStatus,
        };
      }
    } catch (err) {
      console.error(`[scraper] ZenRows fallback failed for ${url}:`, err.message);
    }
  }

  return httpResult;
}

/**
 * Tier-3 fallback: ZenRows premium proxy with JS rendering + antibot.
 * Handles bot-protected sites (Lowe's, Home Depot, GameStop, etc.).
 */
export async function scrapeViaZenRows(url) {
  const ZENROWS_KEY = process.env.ZENROWS_KEY;
  if (!ZENROWS_KEY) return { price: null, stockStatus: null };

  const apiUrl = `https://api.zenrows.com/v1/?apikey=${ZENROWS_KEY}&url=${encodeURIComponent(url)}&premium_proxy=true&js_render=true&antibot=true&wait=4000`;

  let res;
  try {
    res = await fetch(apiUrl, { signal: AbortSignal.timeout(60000) });
  } catch (err) {
    console.error(`[scraper] ZenRows fetch error for ${url}:`, err.message);
    return { price: null, stockStatus: null };
  }
  if (!res.ok) {
    console.log(`[scraper] ZenRows returned ${res.status} for ${url}`);
    return { price: null, stockStatus: null };
  }

  const html = await res.text();
  if (html.length < 5000) {
    console.log(`[scraper] ZenRows response too small (${html.length} bytes) for ${url}, likely bot block`);
    return { price: null, stockStatus: null };
  }

  const $ = load(html);

  // 1. JSON-LD
  let price = extractPriceFromJsonLd($);

  // 2. itemprop
  if (!price) price = parsePrice($("[itemprop=price]").attr("content") || $("[itemprop=price]").text());

  // 3. Regex scan for price patterns in full HTML (catches script tags, inline JSON, data attrs)
  if (!price) {
    const matches = [...html.matchAll(/"(?:price|currentPrice|salePrice|specialPrice|regularPrice)"\s*:\s*"?(\d+\.?\d{0,2})"?/g)];
    const prices = matches.map(m => parseFloat(m[1])).filter(p => p > 0.5 && p < 100000);
    if (prices.length) price = prices[0];
  }

  // Stock detection
  const bodyText = $("body").text().toLowerCase();
  let stockStatus = null;
  if (/add to cart|in stock|available/i.test(bodyText)) stockStatus = "in_stock";
  if (/out of stock|sold out|unavailable/i.test(bodyText)) stockStatus = "out_of_stock";

  console.log(`[scraper] ZenRows result for ${url}: price=${price}, stock=${stockStatus} (html=${html.length} bytes)`);
  return { price, stockStatus };
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
