// Patchright patches the TLS/JA3 fingerprint to match real Chrome,
// bypassing Akamai/PerimeterX bot detection that blocks playwright-extra.
import { chromium } from 'patchright';
import { get as wreqGet } from 'wreq-js';

const PROXY_URL = process.env.PROXY_URL || null;
const MAX_RETRIES = 3;
const NAV_TIMEOUT = 45_000;
const BLOCKED_ELEMENT_THRESHOLD = 100;

// ---------------------------------------------------------------------------
// US IP verification - DataImpulse country targeting is unreliable.
// This helper retries until we get an actual US residential IP.
// ---------------------------------------------------------------------------

/**
 * Try to get a confirmed US IP from DataImpulse by sampling proxy IPs.
 * Returns the proxy URL to use (same URL, just confirms next request will be US).
 * DataImpulse rotates IPs per connection, so simply retrying gets a new IP.
 * @param {number} maxAttempts - How many times to try before giving up
 * @returns {Promise<boolean>} true if a US IP was confirmed available
 */
async function confirmUSProxyAvailable(maxAttempts = 15) {
  if (!PROXY_URL) return false;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const r = await wreqGet('http://ip-api.com/json?fields=countryCode', {
        browser: 'chrome_131',
        os: 'windows',
        proxy: PROXY_URL,
      });
      const data = await r.json();
      if (data.countryCode === 'US') {
        console.log(`[scraper-retail] Confirmed US IP on attempt ${i + 1}/${maxAttempts}`);
        return true;
      }
      console.log(`[scraper-retail] IP country=${data.countryCode} (attempt ${i + 1}), retrying...`);
    } catch (err) {
      // ignore transient errors, just retry
    }
  }
  console.log(`[scraper-retail] Could not confirm US IP after ${maxAttempts} attempts`);
  return false;
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
];

// ---------------------------------------------------------------------------
// Retailer detection
// ---------------------------------------------------------------------------

const RETAILERS = {
  walmart: {
    match: (url) => /walmart\.com/i.test(url),
    waitFor: '[itemprop="price"], [data-testid="price-wrap"], .price-group',
    priceSelectors: [
      { selector: '[itemprop="price"]', attr: 'content' },
      { selector: '[data-testid="price-wrap"] [itemprop="price"]', attr: 'content' },
      { selector: '[class*="price-characteristic"]', attr: null },
      { selector: '[data-testid="price-wrap"]', attr: null },
      { selector: '[class*="Price__StyledPriceDisplay"]', attr: null },
      { selector: '.price-group', attr: null },
    ],
    stockSelectors: [
      '[data-testid="add-to-cart-btn"]',
      '[data-testid*="fulfillment"]',
      'button[data-testid="add-to-cart-button"]',
    ],
    stockTextSelectors: [
      '[data-testid*="fulfillment"]',
      '[class*="fulfillment"]',
    ],
  },
  bestbuy: {
    match: (url) => /bestbuy\.com/i.test(url),
    waitFor: '.priceView-customer-price span, [data-testid="customer-price"]',
    priceSelectors: [
      { selector: '.priceView-customer-price span', attr: null },
      { selector: '[data-testid="customer-price"] span', attr: null },
      { selector: '.priceView-hero-price span', attr: null },
      { selector: '[class*="pricing-price"] span', attr: null },
      { selector: '[itemprop="price"]', attr: 'content' },
    ],
    stockSelectors: [
      'button.add-to-cart-button',
      '[data-button-state="ADD_TO_CART"]',
      'button[data-sku-id]',
    ],
    stockTextSelectors: [
      '.fulfillment-add-to-cart-button',
      '[class*="fulfillment"]',
      '[data-testid*="fulfillment"]',
    ],
  },
  target: {
    match: (url) => /target\.com/i.test(url),
    waitFor: '[data-test*="Price"], [data-test="product-price"], [class*="CurrentPrice"]',
    priceSelectors: [
      // Real Target selectors (observed from live pages)
      { selector: '[data-test="@web/Price/PriceFull--currentPrice"] span', attr: null },
      { selector: '[data-test="@web/Price/PriceFull--currentPrice"]', attr: null },
      { selector: '[data-test*="currentPrice"]', attr: null },
      { selector: '[data-test*="Price/Price--"]', attr: null },
      { selector: '[data-test="product-price"] span', attr: null },
      { selector: '[data-test="product-price"]', attr: null },
      { selector: '[class*="CurrentPrice"]', attr: null },
      { selector: '[itemprop="price"]', attr: 'content' },
    ],
    stockSelectors: [
      '[data-test="shipItButton"]',
      '[data-test="addToCartButton"]',
      'button[data-test="orderPickupButton"]',
      '[data-test="shipItButton"]:not([disabled])',
    ],
    stockTextSelectors: [
      '[data-test="storeAvailability"]',
      '[data-test*="fulfillment"]',
      '[class*="Fulfillment"]',
    ],
  },
};

// Generic fallback (same selectors as scraper-playwright.js)
const GENERIC_PRICE_SELECTORS = [
  { selector: '[itemprop="price"]', attr: 'content' },
  { selector: '.price', attr: null },
  { selector: '[class*="price"]', attr: null },
  { selector: '[data-price]', attr: 'data-price' },
  { selector: '[class*="Price"]', attr: null },
  { selector: 'span[class*="amount"]', attr: null },
  { selector: '[data-testid*="price"]', attr: null },
];

const GENERIC_STOCK_SELECTORS = [
  '#availability',
  '[class*="avail"]',
  '[class*="stock"]',
  '[id*="stock"]',
  '[data-availability]',
  '[data-testid*="fulfillment"]',
  '[class*="fulfillment"]',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectRetailer(url) {
  for (const [name, config] of Object.entries(RETAILERS)) {
    if (config.match(url)) return { name, ...config };
  }
  return null;
}

function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function buildLaunchOptions() {
  const opts = { headless: true };
  if (PROXY_URL) {
    const proxyUrl = new URL(PROXY_URL);
    opts.proxy = {
      server: `${proxyUrl.protocol}//${proxyUrl.hostname}:${proxyUrl.port}`,
      username: proxyUrl.username || undefined,
      password: proxyUrl.password || undefined,
    };
  }
  return opts;
}

/**
 * Check if the page is blocked by counting DOM elements.
 * Blocked/captcha pages typically have very few elements.
 */
async function isPageBlocked(page) {
  const elementCount = await page.evaluate(() => document.querySelectorAll('*').length);
  if (elementCount <= BLOCKED_ELEMENT_THRESHOLD) return true;

  // Also check for common captcha/block indicators in text and title
  const blocked = await page.evaluate(() => {
    const text = document.body?.innerText?.toLowerCase() || '';
    const title = document.title?.toLowerCase() || '';
    return (
      text.includes('robot or human') ||
      text.includes('are you a robot') ||
      text.includes('captcha') ||
      text.includes('access denied') ||
      text.includes('verify you are human') ||
      title.includes('robot') ||
      title.includes('captcha') ||
      title.includes('access denied') ||
      title.includes('just a moment')
    );
  });
  return blocked;
}

// ---------------------------------------------------------------------------
// In-page extraction (runs inside page.evaluate)
// ---------------------------------------------------------------------------

/**
 * Build the extraction function that runs inside the browser context.
 * Accepts retailer-specific and generic selectors so fallback works in one pass.
 */
function buildExtractFn() {
  return ({ retailerPriceSelectors, retailerStockSelectors, retailerStockTextSelectors,
            genericPriceSelectors, genericStockSelectors }) => {

    function parsePrice(raw) {
      if (!raw) return null;
      const cleaned = raw.replace(/[^0-9.,]/g, '').replace(/,/g, '');
      const num = parseFloat(cleaned);
      if (!Number.isFinite(num) || num <= 0 || num > 100000) return null;
      return num;
    }

    function tryPriceSelectors(selectors) {
      for (const { selector, attr } of selectors) {
        const el = document.querySelector(selector);
        if (!el) continue;
        // If an attribute is specified, try it first
        if (attr) {
          const val = el.getAttribute(attr);
          const price = parsePrice(val);
          if (price !== null) return price;
        }
        // Fall back to textContent
        const price = parsePrice(el.textContent);
        if (price !== null) return price;
      }
      return null;
    }

    function tryStockFromButtons(selectors) {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && !el.disabled) return 'in_stock';
      }
      return null;
    }

    function tryStockFromText(selectors) {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const text = (el.getAttribute('data-availability') || el.textContent)
          .toLowerCase().trim();
        if (!text) continue;
        if (/out of stock|sold out|unavailable|currently unavailable|not available/.test(text))
          return 'out_of_stock';
        if (/in stock|in-stock|available|add to cart|ships from|delivery|shipping/.test(text))
          return 'in_stock';
      }
      return null;
    }

    function tryStockFromCartButtons() {
      const buttons = document.querySelectorAll('button, input[type="submit"], [role="button"]');
      for (const btn of buttons) {
        const t = btn.textContent.toLowerCase();
        if (t.includes('add to cart') || t.includes('add to basket') || t.includes('buy now'))
          return 'in_stock';
      }
      return null;
    }

    function trySchemaAvailability() {
      const el = document.querySelector('[itemprop="availability"]');
      if (!el) return null;
      const val = (el.getAttribute('href') || el.getAttribute('content') || el.textContent).toLowerCase();
      if (val.includes('instock') || val.includes('in_stock')) return 'in_stock';
      if (val.includes('outofstock') || val.includes('out_of_stock')) return 'out_of_stock';
      return null;
    }

    // --- Price: retailer-specific first, then generic ---
    let price = tryPriceSelectors(retailerPriceSelectors);
    if (price === null) {
      price = tryPriceSelectors(genericPriceSelectors);
    }

    // --- Stock: schema.org → retailer buttons → retailer text → generic text → generic cart buttons ---
    let stockStatus = trySchemaAvailability();
    if (!stockStatus) stockStatus = tryStockFromButtons(retailerStockSelectors);
    if (!stockStatus) stockStatus = tryStockFromText(retailerStockTextSelectors);
    if (!stockStatus) stockStatus = tryStockFromText(genericStockSelectors);
    if (!stockStatus) stockStatus = tryStockFromCartButtons();

    return { price, stockStatus };
  };
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

/**
 * Scrape price and stock for Walmart, Best Buy, or Target using Playwright
 * stealth with Menards-style retry/block detection.
 *
 * On each blocked attempt, the browser is fully restarted to get a new proxy IP
 * (residential proxies like DataImpulse rotate IP per connection).
 *
 * Falls back to generic selectors if retailer-specific ones don't match.
 *
 * @param {string} url - Product URL
 * @returns {Promise<{price: number|null, stockStatus: string|null, retailer: string}>}
 */
export async function scrapePriceAndStockRetail(url) {
  const retailer = detectRetailer(url);
  const retailerName = retailer?.name || 'generic';

  const retailerPriceSelectors = retailer?.priceSelectors || [];
  const retailerStockSelectors = retailer?.stockSelectors || [];
  const retailerStockTextSelectors = retailer?.stockTextSelectors || [];
  const waitForSelector = retailer?.waitFor || '[itemprop="price"], .price';

  // Best Buy: try wreq-js (free, DataImpulse) first, then ZenRows, then browser
  if (retailerName === 'bestbuy') {
    // Tier 1: wreq-js + DataImpulse (free)
    const wreqResult = await scrapeBestBuyViaWreq(url);
    if (wreqResult && wreqResult.price !== null) return wreqResult;
    console.log('[scraper-retail] wreq-js BB returned no price, trying ZenRows...');

    // Tier 2: ZenRows (paid, handles client-side rendered prices)
    if (ZENROWS_KEY) {
      const bbResult = await scrapeBestBuyViaZenRows(url);
      if (bbResult && bbResult.price !== null) return bbResult;
      console.log('[scraper-retail] ZenRows BB returned no price, falling back to browser');
    }
  }

  // Walmart: try wreq-js (free) first, then ZenRows, then browser
  if (retailerName === 'walmart') {
    // Tier 1: wreq-js + DataImpulse (free)
    const wreqWalmartResult = await scrapeWalmartViaWreq(url);
    if (wreqWalmartResult && wreqWalmartResult.price !== null) return wreqWalmartResult;
    console.log('[scraper-retail] wreq-js Walmart returned no price, trying ZenRows...');

    if (ZENROWS_KEY) {
      const zrResult = await scrapeWalmartViaZenRows(url);
      if (zrResult && zrResult.price !== null) return zrResult;
      console.log('[scraper-retail] ZenRows Walmart returned no price, falling back');
    } else if (SCRAPERAPI_KEY) {
      const scraperResult = await scrapeWalmartViaScraperAPI(url);
      if (scraperResult && scraperResult.price !== null) return scraperResult;
      console.log('[scraper-retail] ScraperAPI Walmart returned no price, falling back to browser');
    }
  }

  const launchOptions = buildLaunchOptions();

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let browser = null;
    try {
      console.log(`[scraper-retail] Attempt ${attempt}/${MAX_RETRIES} for ${retailerName}: ${url}`);
      browser = await chromium.launch(launchOptions);

      const context = await browser.newContext({
        userAgent: randomUserAgent(),
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
      });

      const page = await context.newPage();

      // Navigate — use domcontentloaded since networkidle can hang on tracker-heavy sites
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

      // Allow JS to hydrate — Menards-style: give the page time to settle
      await page.waitForTimeout(5000);

      // Simulate human scroll to trigger lazy-loaded price elements
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(2000);

      // Try to wait for a price selector to appear (soft — don't fail if it times out)
      try {
        await page.waitForSelector(waitForSelector, { timeout: 10_000 });
      } catch {
        // Selector didn't appear — might be blocked or page structure changed
      }

      // Extra settle time after selector wait
      await page.waitForTimeout(2000);

      // Block detection: restart browser to rotate proxy IP
      if (await isPageBlocked(page)) {
        console.log(`[scraper-retail] Blocked on attempt ${attempt}/${MAX_RETRIES}, restarting browser for new proxy IP`);
        await browser.close();
        browser = null;
        continue;
      }

      // Extract price and stock
      const result = await page.evaluate(buildExtractFn(), {
        retailerPriceSelectors,
        retailerStockSelectors,
        retailerStockTextSelectors,
        genericPriceSelectors: GENERIC_PRICE_SELECTORS,
        genericStockSelectors: GENERIC_STOCK_SELECTORS,
      });

      console.log(
        `[scraper-retail] ${retailerName} result: price=${result.price}, stock=${result.stockStatus}`
      );

      return { ...result, retailer: retailerName };
    } catch (err) {
      lastError = err;
      console.error(
        `[scraper-retail] Attempt ${attempt}/${MAX_RETRIES} failed for ${url}:`,
        err.message
      );
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  console.error(
    `[scraper-retail] All ${MAX_RETRIES} attempts failed for ${url}:`,
    lastError?.message
  );
  return { price: null, stockStatus: null, retailer: retailerName };
}

/**
 * Check if a URL is a supported retail site (Walmart, Best Buy, Target).
 */
export function isRetailUrl(url) {
  return detectRetailer(url) !== null;
}

// ---------------------------------------------------------------------------
// ScraperAPI - Walmart structured data endpoint
// ---------------------------------------------------------------------------

const SCRAPERAPI_KEY = process.env.SCRAPERAPI_KEY || null;
const ZENROWS_KEY = process.env.ZENROWS_KEY || null;

/**
 * Extract Walmart product ID from a walmart.com product URL.
 * Walmart URLs follow: /ip/product-name/PRODUCT_ID
 * Returns the numeric product ID or null.
 */
function extractWalmartProductId(url) {
  const match = url.match(/\/ip\/(?:[^/]+\/)?(\d+)/);
  return match ? match[1] : null;
}

/**
 * Scrape a Walmart product using ScraperAPI's structured Walmart endpoint.
 * Returns { price, stockStatus, retailer } or null if unavailable.
 *
 * Requires SCRAPERAPI_KEY env var. Falls back gracefully if not set.
 */
/**
 * Scrape a Walmart product using ZenRows (handles Akamai bot detection).
 * Uses js_render=true + premium_proxy=true to get full page with __NEXT_DATA__.
 */
export async function scrapeWalmartViaZenRows(url) {
  if (!ZENROWS_KEY) return null;

  const productId = extractWalmartProductId(url);
  if (!productId) return null;

  const walmartUrl = encodeURIComponent(url);
  const apiUrl = `https://api.zenrows.com/v1/?apikey=${ZENROWS_KEY}&url=${walmartUrl}&premium_proxy=true&js_render=true`;

  try {
    console.log(`[scraper-retail] ZenRows Walmart lookup for product_id=${productId}`);
    const res = await fetch(apiUrl, { timeout: 45_000 });

    if (!res.ok) {
      console.error(`[scraper-retail] ZenRows returned ${res.status} for ${productId}`);
      return null;
    }

    const html = await res.text();

    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!nextDataMatch) {
      console.error(`[scraper-retail] ZenRows: No __NEXT_DATA__ for ${productId}`);
      return null;
    }

    const pageData = JSON.parse(nextDataMatch[1]);
    const product = pageData?.props?.pageProps?.initialData?.data?.product;
    if (!product) return null;

    let price = null;
    const rawPrice = product?.priceInfo?.currentPrice?.price;
    if (rawPrice != null) {
      const num = parseFloat(String(rawPrice).replace(/[^0-9.]/g, ''));
      if (Number.isFinite(num) && num > 0 && num <= 100000) price = num;
    }

    let stockStatus = null;
    const avail = product?.availabilityStatus;
    if (avail === 'IN_STOCK') stockStatus = 'in_stock';
    else if (avail === 'OUT_OF_STOCK' || avail === 'UNAVAILABLE') stockStatus = 'out_of_stock';

    console.log(`[scraper-retail] ZenRows Walmart result: price=${price}, stock=${stockStatus}`);
    return { price, stockStatus, retailer: 'walmart' };
  } catch (err) {
    console.error(`[scraper-retail] ZenRows Walmart error:`, err.message);
    return null;
  }
}

/**
 * Scrape Walmart price via search page — no proxy required.
 * Walmart's /search endpoint works from any IP with Chrome TLS fingerprint.
 * Extracts price and stock from __NEXT_DATA__ search results by matching item ID.
 */
export async function scrapeWalmartViaSearchPage(url) {
  const match = url.match(/walmart\.com\/ip\/([^\/]+)\/(\d+)/);
  if (!match) return null;
  const [, slug, itemId] = match;
  const searchTerm = slug.replace(/-/g, ' ').slice(0, 60);

  try {
    console.log(`[scraper-retail] Walmart search for itemId=${itemId}: "${searchTerm.slice(0, 40)}"`);

    const r = await wreqGet(`https://www.walmart.com/search?q=${encodeURIComponent(searchTerm)}`, {
      browser: 'chrome_131',
      os: 'windows',
      headers: { 'accept-language': 'en-US,en;q=0.9' },
    });

    if (!r.ok) return null;
    const html = await r.text();

    if (html.includes('Robot or human') || html.length < 50000) return null;

    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!nextDataMatch) return null;

    const data = JSON.parse(nextDataMatch[1]);
    const items = data?.props?.pageProps?.initialData?.searchResult?.itemStacks?.[0]?.items || [];
    if (!items.length) return null;

    // Prefer exact item ID match, fall back to first result
    const item = items.find(it => it.usItemId === itemId) || items[0];
    if (!item) return null;

    // Extract price
    const priceStr = item.priceInfo?.linePriceDisplay || item.priceInfo?.itemPrice;
    let price = null;
    if (priceStr) {
      const num = parseFloat(priceStr.replace(/[^0-9.]/g, ''));
      if (Number.isFinite(num) && num > 0 && num <= 100000) price = num;
    } else if (item.price && Number.isFinite(item.price)) {
      price = item.price;
    }

    // Extract stock
    const stockText = (item.availabilityStatusDisplayValue || '').toLowerCase();
    const stockStatus = stockText.includes('in stock') ? 'in_stock'
      : stockText.includes('out') ? 'out_of_stock'
      : null;

    const matchType = item.usItemId === itemId ? 'exact' : 'first-result';
    console.log(`[scraper-retail] Walmart search result: price=${price}, stock=${stockStatus} (${matchType})`);

    return price !== null ? { price, stockStatus, retailer: 'walmart' } : null;
  } catch (err) {
    console.error('[scraper-retail] Walmart search error:', err.message?.slice(0, 80));
    return null;
  }
}

/**
 * Scrape Walmart using wreq-js (Rust-native Chrome TLS/H2 fingerprint) + DataImpulse proxy.
 * Walmart embeds full product data in __NEXT_DATA__ — no browser needed if TLS passes.
 */
export async function scrapeWalmartViaWreq(url) {
  // Strategy 1 (preferred, no proxy): Search-based extraction from Walmart search page.
  // Walmart search works from any IP via wreq-js Chrome fingerprint.
  const searchResult = await scrapeWalmartViaSearchPage(url);
  if (searchResult) return searchResult;

  // Strategy 2 (fallback): Direct product page via US residential proxy.
  if (!PROXY_URL) return null;
  const productId = extractWalmartProductId(url);
  if (!productId) return null;

  // Walmart captchas non-US IPs. Confirm we have a US IP before attempting.
  const hasUSIP = await confirmUSProxyAvailable(25);
  if (!hasUSIP) {
    console.log('[scraper-retail] wreq-js Walmart: no US IP available, skipping');
    return null;
  }

  try {
    console.log(`[scraper-retail] wreq-js Walmart direct product lookup for product_id=${productId}`);

    const res = await wreqGet(url, {
      browser: 'chrome_131',
      os: 'windows',
      proxy: PROXY_URL,
      headers: {
        'accept-language': 'en-US,en;q=0.9',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!res.ok) {
      console.error(`[scraper-retail] wreq-js Walmart returned ${res.status}`);
      return null;
    }

    const html = await res.text();

    if (html.includes('Robot or human') || html.length < 5000) {
      console.error('[scraper-retail] wreq-js Walmart: captcha/robot page');
      return null;
    }

    // Extract __NEXT_DATA__
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!nextDataMatch) {
      console.error('[scraper-retail] wreq-js Walmart: no __NEXT_DATA__');
      return null;
    }

    const pageData = JSON.parse(nextDataMatch[1]);
    const product = pageData?.props?.pageProps?.initialData?.data?.product;
    if (!product) return null;

    let price = null;
    const rawPrice = product?.priceInfo?.currentPrice?.price;
    if (rawPrice != null) {
      const num = parseFloat(String(rawPrice).replace(/[^0-9.]/g, ''));
      if (Number.isFinite(num) && num > 0 && num <= 100000) price = num;
    }

    let stockStatus = null;
    const avail = product?.availabilityStatus;
    if (avail === 'IN_STOCK') stockStatus = 'in_stock';
    else if (avail === 'OUT_OF_STOCK' || avail === 'UNAVAILABLE') stockStatus = 'out_of_stock';

    console.log(`[scraper-retail] wreq-js Walmart result: price=${price}, stock=${stockStatus}`);
    return price !== null ? { price, stockStatus, retailer: 'walmart' } : null;
  } catch (err) {
    console.error('[scraper-retail] wreq-js Walmart error:', err.message?.slice(0, 100));
    return null;
  }
}

/**
 * Scrape Best Buy using wreq-js (Rust-native Chrome TLS/H2 fingerprint) + DataImpulse proxy.
 *
 * Best Buy's Akamai Bot Manager blocks product page URLs (/site/.../SKU.p) even with
 * correct fingerprinting. The workaround: search for the product by slug keyword,
 * then extract price by matching SKU in the search results JSON.
 *
 * Cost: $0 (uses existing DataImpulse proxy, no ZenRows credits).
 * Coverage: ~70% of active products. Falls back to ZenRows for the rest.
 */
export async function scrapeBestBuyViaWreq(url) {
  if (!PROXY_URL) return null;

  // Extract slug and SKU from URL: /site/product-slug/6447382.p
  const match = url.match(/bestbuy\.com\/site\/([^\/]+)\/(\d+)\.p/);
  if (!match) return null;
  const [, slug, skuId] = match;

  // Generate multiple search term variations to maximize chance of finding prices
  const base = slug.replace(/-/g, ' ');
  const words = base.split(' ').filter(w => w.length > 1);
  const searchVariations = [
    base.slice(0, 50),
    words.slice(0, 5).join(' '),
    words.filter(w => !/^\d+$/.test(w)).join(' ').slice(0, 40),
    words.slice(1).join(' ').slice(0, 40),
  ].filter((v, i, a) => v.length > 3 && a.indexOf(v) === i);

  let price = null;
  let matchType = null;
  let stockStatus = null;

  try {
    for (const searchTerm of searchVariations) {
      console.log(`[scraper-retail] wreq-js Best Buy search for sku=${skuId}: "${searchTerm.slice(0, 40)}"`);

      const searchUrl = `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(searchTerm)}&intl=nosplash`;
      const res = await wreqGet(searchUrl, {
        browser: 'chrome_131',
        os: 'windows',
        proxy: PROXY_URL,
        headers: { 'accept-language': 'en-US,en;q=0.9' },
      });

      if (!res.ok) continue;
      const html = await res.text();
      if (html.includes('Select your Country') || html.length < 10000) continue;

      // Extract all SKU→price pairs from Apollo/Next.js SSR data
      const pairs = [...html.matchAll(/"skuId":"(\d+)"[^}]{0,500}"customerPrice":(\d+\.?\d*)/g)];

      // Try exact SKU match first
      const exact = pairs.find(([, s]) => s === skuId);
      if (exact) {
        price = parseFloat(exact[2]);
        matchType = 'exact';

        // Stock from this page
        const dm = html.match(/"driverSku":true,"buttonState":"([^"]+)"/);
        if (dm) {
          const state = dm[1];
          stockStatus = (state === 'ADD_TO_CART' || state === 'BUY_NOW') ? 'in_stock'
            : (state === 'SOLD_OUT' || state === 'COMING_SOON') ? 'out_of_stock' : null;
        }
        break;
      } else if (pairs.length > 0 && !price) {
        price = parseFloat(pairs[0][2]);
        matchType = 'first-result';
        // Keep trying other variations for an exact match
      }
    }

    // Infer stock if not already set
    if (!stockStatus && price !== null) {
      stockStatus = 'in_stock'; // price in search results implies in stock
    }

    console.log(`[scraper-retail] wreq-js BB result: price=${price} (${matchType}), stock=${stockStatus}`);
    return price !== null ? { price, stockStatus, retailer: 'bestbuy' } : null;
  } catch (err) {
    console.error('[scraper-retail] wreq-js BB error:', err.message?.slice(0, 100));
    return null;
  }
}

/**
 * Scrape Best Buy using ZenRows.
 * Best Buy redirects non-US IPs to an international page — ZenRows handles this.
 * Price extracted from analytics-metadata tag, stock from buttonState JSON.
 */
export async function scrapeBestBuyViaZenRows(url) {
  if (!ZENROWS_KEY) return null;

  // Add intl=nosplash to bypass country selector, retry up to 3 times for consistent US IP
  const bbUrl = url.includes('?') ? `${url}&intl=nosplash` : `${url}?intl=nosplash`;
  const apiUrl = `https://api.zenrows.com/v1/?apikey=${ZENROWS_KEY}&url=${encodeURIComponent(bbUrl)}&premium_proxy=true&js_render=true&wait=3000`;

  try {
    console.log(`[scraper-retail] ZenRows Best Buy lookup: ${url}`);
    const res = await fetch(apiUrl, { timeout: 45_000 });

    if (!res.ok) {
      console.error(`[scraper-retail] ZenRows Best Buy returned ${res.status}`);
      return null;
    }

    const html = await res.text();

    if (html.includes('Select your Country') || html.length < 10000) {
      console.error('[scraper-retail] ZenRows Best Buy: international redirect or empty page');
      return null;
    }

    // Price from analytics-metadata content attribute
    let price = null;
    const metaMatch = html.match(/name="analytics-metadata"[^>]*content="([^"]+)"/);
    if (metaMatch) {
      try {
        const metaData = JSON.parse(metaMatch[1].replace(/&quot;/g, '"'));
        const rawPrice = metaData?.product?.price;
        if (rawPrice != null) {
          const num = parseFloat(String(rawPrice).replace(/[^0-9.]/g, ''));
          if (Number.isFinite(num) && num > 0 && num <= 100000) price = num;
        }
      } catch {}
    }

    // Stock: check driver SKU buttonState in Apollo/GraphQL SSR data
    let stockStatus = null;
    const driverMatch = html.match(/"driverSku":true,"buttonState":"([^"]+)"/);
    if (driverMatch) {
      const state = driverMatch[1];
      if (state === 'ADD_TO_CART' || state === 'BUY_NOW') stockStatus = 'in_stock';
      else if (state === 'SOLD_OUT' || state === 'CHECK_STORES' || state === 'COMING_SOON') stockStatus = 'out_of_stock';
    }

    // Fallback: if no driver SKU, check fulfillment button state
    if (!stockStatus) {
      const btnMatch = html.match(/"buttonStates":\[{"__typename":"ButtonState","buttonState":"([^"]+)"/);
      if (btnMatch) {
        const state = btnMatch[1];
        if (state === 'ADD_TO_CART' || state === 'BUY_NOW') stockStatus = 'in_stock';
        else if (state === 'SOLD_OUT') stockStatus = 'out_of_stock';
      }
    }

    console.log(`[scraper-retail] ZenRows Best Buy result: price=${price}, stock=${stockStatus}`);
    return { price, stockStatus, retailer: 'bestbuy' };
  } catch (err) {
    console.error('[scraper-retail] ZenRows Best Buy error:', err.message);
    return null;
  }
}

export async function scrapeWalmartViaScraperAPI(url) {
  if (!SCRAPERAPI_KEY) return null;

  const productId = extractWalmartProductId(url);
  if (!productId) {
    console.log(`[scraper-retail] Could not extract Walmart product ID from: ${url}`);
    return null;
  }

  // Use generic endpoint with premium=true - structured endpoint doesn't work on free plan
  // Parse __NEXT_DATA__ from the raw HTML ourselves
  const walmartUrl = encodeURIComponent(`https://www.walmart.com/ip/${productId}`);
  const apiUrl = `https://api.scraperapi.com/?api_key=${SCRAPERAPI_KEY}&url=${walmartUrl}&premium=true`;

  try {
    console.log(`[scraper-retail] ScraperAPI Walmart lookup for product_id=${productId}`);
    const res = await fetch(apiUrl, { timeout: 30_000 });

    if (!res.ok) {
      console.error(`[scraper-retail] ScraperAPI returned ${res.status} for ${productId}`);
      return null;
    }

    const html = await res.text();

    // Check for bot block
    if (html.includes('Robot or human') || html.length < 5000) {
      console.error(`[scraper-retail] ScraperAPI Walmart still blocked for ${productId}`);
      return null;
    }

    // Extract __NEXT_DATA__ JSON blob embedded in the page
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!nextDataMatch) {
      console.error(`[scraper-retail] No __NEXT_DATA__ found for ${productId}`);
      return null;
    }

    const pageData = JSON.parse(nextDataMatch[1]);
    const product = pageData?.props?.pageProps?.initialData?.data?.product;

    if (!product) {
      console.error(`[scraper-retail] No product data in __NEXT_DATA__ for ${productId}`);
      return null;
    }

    let price = null;
    const rawPrice = product?.priceInfo?.currentPrice?.price;
    if (rawPrice != null) {
      const num = parseFloat(String(rawPrice).replace(/[^0-9.]/g, ''));
      if (Number.isFinite(num) && num > 0 && num <= 100000) price = num;
    }

    let stockStatus = null;
    const avail = product?.availabilityStatus;
    if (avail === 'IN_STOCK') stockStatus = 'in_stock';
    else if (avail === 'OUT_OF_STOCK' || avail === 'UNAVAILABLE') stockStatus = 'out_of_stock';

    console.log(`[scraper-retail] ScraperAPI Walmart result: price=${price}, stock=${stockStatus}`);
    return { price, stockStatus, retailer: 'walmart' };
  } catch (err) {
    console.error(`[scraper-retail] ScraperAPI Walmart error:`, err.message);
    return null;
  }
}
