/**
 * Specialty scrapers for sites that need custom approaches:
 * - GameStop: ZenRows without js_render (Cloudflare Turnstile)
 * - Hy-Vee: Direct GraphQL API (no auth needed)
 * - TJ Maxx: quickview.jsp endpoint (bypasses Kasada)
 * - Home Depot: ZenRows + Apollo state extraction
 * - Lowes: ZenRows without wait param + JSON-LD
 * - Michaels: wreq-js direct fetch + JSON-LD (handled by generic scraper)
 */

import { load } from 'cheerio';
import { get as wreqGet } from 'wreq-js';

const ZENROWS_KEY = process.env.ZENROWS_KEY || null;

// ---------------------------------------------------------------------------
// Domain detection
// ---------------------------------------------------------------------------

const SPECIALTY_DOMAINS = {
  gamestop: { match: (url) => /gamestop\.com/i.test(url) },
  hyvee: { match: (url) => /hy-vee\.com/i.test(url) },
  tjmaxx: { match: (url) => /tjmaxx\.tjx\.com/i.test(url) },
  homedepot: { match: (url) => /homedepot\.com/i.test(url) },
  lowes: { match: (url) => /lowes\.com/i.test(url) },
  michaels: { match: (url) => /michaels\.com/i.test(url) },
};

function detectSpecialty(url) {
  for (const [name, config] of Object.entries(SPECIALTY_DOMAINS)) {
    if (config.match(url)) return name;
  }
  return null;
}

export function isSpecialtyUrl(url) {
  return detectSpecialty(url) !== null;
}

/**
 * Main entry point — routes to the right specialty scraper.
 */
export async function scrapePriceAndStockSpecialty(url) {
  const site = detectSpecialty(url);
  if (!site) return { price: null, stockStatus: null };

  const scrapers = {
    gamestop: scrapeGameStop,
    hyvee: scrapeHyVee,
    tjmaxx: scrapeTJMaxx,
    homedepot: scrapeHomeDepot,
    lowes: scrapeLowes,
    michaels: scrapeMichaels,
  };

  try {
    console.log(`[scraper-specialty] Routing ${url} to ${site} scraper`);
    const result = await scrapers[site](url);
    console.log(`[scraper-specialty] ${site} result: price=${result.price}, stock=${result.stockStatus}`);
    return result;
  } catch (err) {
    console.error(`[scraper-specialty] ${site} scraper failed:`, err.message);
    return { price: null, stockStatus: null };
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function parsePrice(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^0-9.,]/g, '').replace(/,/g, '');
  const num = parseFloat(cleaned);
  if (!Number.isFinite(num) || num <= 0 || num > 100000) return null;
  return num;
}

function extractJsonLdPrice(html) {
  const $ = load(html);
  const scripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    try {
      const data = JSON.parse($(scripts[i]).html());
      const price = findPriceInSchema(data);
      if (price !== null) return price;
    } catch { /* skip malformed JSON-LD */ }
  }
  return null;
}

function findPriceInSchema(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const p = findPriceInSchema(item);
      if (p !== null) return p;
    }
    return null;
  }
  const type = obj['@type'];
  const isProduct = type === 'Product' || type === 'IndividualProduct' ||
    (Array.isArray(type) && (type.includes('Product') || type.includes('IndividualProduct')));
  if (isProduct && obj.offers) {
    const offerList = Array.isArray(obj.offers) ? obj.offers : [obj.offers];
    for (const offer of offerList) {
      const rawPrice = offer.price ?? offer.lowPrice ?? offer.highPrice;
      if (rawPrice != null) {
        const num = parseFloat(String(rawPrice).replace(/[^0-9.]/g, ''));
        if (Number.isFinite(num) && num > 0 && num <= 100000) return num;
      }
    }
  }
  if (obj['@graph']) return findPriceInSchema(obj['@graph']);
  return null;
}

function detectStockFromHtml(html) {
  const lower = html.toLowerCase();
  if (/out of stock|sold out|unavailable|currently unavailable/i.test(lower)) return 'out_of_stock';
  if (/add to cart|in stock|available/i.test(lower)) return 'in_stock';
  return null;
}

async function zenrowsFetch(url, { jsRender = false, antibot = true, wait = null } = {}) {
  if (!ZENROWS_KEY) throw new Error('ZENROWS_KEY not set');
  let apiUrl = `https://api.zenrows.com/v1/?apikey=${ZENROWS_KEY}&url=${encodeURIComponent(url)}&premium_proxy=true`;
  if (antibot) apiUrl += '&antibot=true';
  if (jsRender) apiUrl += '&js_render=true';
  if (wait) apiUrl += `&wait=${wait}`;

  const res = await fetch(apiUrl, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`ZenRows returned ${res.status} for ${url}`);
  return res.text();
}

// ---------------------------------------------------------------------------
// GameStop — ZenRows without js_render, JSON-LD extraction
// Cloudflare Turnstile blocks everything else. ZenRows with js_render times out.
// Without js_render, ZenRows solves the CF challenge server-side (~37s).
// ---------------------------------------------------------------------------

async function scrapeGameStop(url) {
  const html = await zenrowsFetch(url, { jsRender: false, antibot: true });

  if (html.length < 5000) {
    console.log(`[scraper-specialty] GameStop: response too small (${html.length} bytes)`);
    return { price: null, stockStatus: null };
  }

  const price = extractJsonLdPrice(html);
  const stockStatus = detectStockFromHtml(html);

  return { price, stockStatus };
}

// ---------------------------------------------------------------------------
// Hy-Vee — Direct GraphQL API at api.prod.hy-vee.cloud/graphql
// No auth needed. Prices are store-specific (default storeId=1759 Urbandale, IA).
// ---------------------------------------------------------------------------

function extractHyVeeProductId(url) {
  const match = url.match(/\/p\/(\d+)\//);
  return match ? parseInt(match[1], 10) : null;
}

async function scrapeHyVee(url) {
  const productId = extractHyVeeProductId(url);
  if (!productId) throw new Error(`Cannot extract Hy-Vee product ID from ${url}`);

  const DEFAULT_STORE_ID = 1759; // Urbandale, Iowa (default store)

  const query = `
    query GetProductPrice($productId: Int!, $storeId: Int!) {
      storeProducts(whereProductIds: [$productId], where: { storeId: $storeId }) {
        storeProducts {
          price
          priceMultiple
          onSale
          isActive
          product {
            productId
            name
          }
        }
      }
    }
  `;

  const res = await fetch('https://api.prod.hy-vee.cloud/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Origin': 'https://www.hy-vee.com',
    },
    body: JSON.stringify({ query, variables: { productId, storeId: DEFAULT_STORE_ID } }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`Hy-Vee GraphQL returned ${res.status}`);

  const json = await res.json();
  const sp = json?.data?.storeProducts?.storeProducts?.[0];
  if (!sp) return { price: null, stockStatus: null };

  const price = typeof sp.price === 'number' ? sp.price : parsePrice(sp.price);
  const stockStatus = sp.isActive ? 'in_stock' : 'out_of_stock';

  console.log(`[scraper-specialty] Hy-Vee: ${sp.product?.name} = $${price} (onSale=${sp.onSale}, active=${sp.isActive})`);
  return { price, stockStatus };
}

// ---------------------------------------------------------------------------
// TJ Maxx — quickview.jsp endpoint bypasses Kasada bot protection entirely.
// Returns TJXdata.productData JS object with full product payload.
// ---------------------------------------------------------------------------

function extractTJMaxxProductId(url) {
  const match = url.match(/\/(\d{10,})$/);
  return match ? match[1] : null;
}

async function scrapeTJMaxx(url) {
  const productId = extractTJMaxxProductId(url);
  if (!productId) throw new Error(`Cannot extract TJ Maxx product ID from ${url}`);

  const quickviewUrl = `https://tjmaxx.tjx.com/store/modal/quickview.jsp?productId=${productId}`;

  const res = await wreqGet(quickviewUrl, {
    browser: 'chrome_131',
    os: 'windows',
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
  });

  if (!res.ok) throw new Error(`TJ Maxx quickview returned ${res.status}`);

  const html = await res.text();

  // Extract TJXdata.productData JSON from inline script
  // Format: TJXdata.productData = {"prodId":{...nested...}}; — deeply nested, use bracket counting
  const marker = 'TJXdata.productData';
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) throw new Error('TJ Maxx: TJXdata.productData not found');

  const jsonStart = html.indexOf('{', markerIdx);
  if (jsonStart === -1) throw new Error('TJ Maxx: no JSON after productData marker');

  let depth = 0;
  let jsonEnd = jsonStart;
  for (let i = jsonStart; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { jsonEnd = i + 1; break; } }
  }

  const rawJson = html.slice(jsonStart, jsonEnd);
  const productDataMap = JSON.parse(rawJson);

  // The map is keyed by product ID — get the first (and only) entry
  const productData = productDataMap[productId] || Object.values(productDataMap)[0];
  if (!productData) throw new Error('TJ Maxx: product not found in productData');

  const price = parsePrice(productData.price);

  // Stock: check prdQuantity or sku quantities
  const qty = parseInt(productData.prdQuantity, 10);
  const stockStatus = qty > 0 ? 'in_stock' : 'out_of_stock';

  console.log(`[scraper-specialty] TJ Maxx: ${productData.name} = $${price} (qty=${qty})`);
  return { price, stockStatus };
}

// ---------------------------------------------------------------------------
// Home Depot — ZenRows + Apollo state extraction for accurate pricing.
// The Apollo cache has the authoritative price; regex on body text can
// pick up promo/credit-card prices instead.
// ---------------------------------------------------------------------------

function extractHomeDepotApolloPrice(html) {
  const startMarker = 'window.__APOLLO_STATE__=';
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) return null;

  // Find the JSON object by bracket-counting from the opening {
  const jsonStart = startIdx + startMarker.length;
  let depth = 0;
  let jsonEnd = jsonStart;
  for (let i = jsonStart; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) { jsonEnd = i + 1; break; }
    }
  }

  try {
    const state = JSON.parse(html.slice(jsonStart, jsonEnd));

    // Find the product key (starts with 'base-catalog-')
    const productKey = Object.keys(state).find(k => k.startsWith('base-catalog-'));
    if (!productKey) return null;

    const product = state[productKey];
    // Find the pricing key (starts with 'pricing(')
    const pricingKey = Object.keys(product).find(k => k.startsWith('pricing('));
    if (!pricingKey) return null;

    const pricing = product[pricingKey];
    const value = pricing?.value;
    if (typeof value === 'number' && value > 0 && value <= 100000) return value;

    return parsePrice(value);
  } catch {
    return null;
  }
}

async function scrapeHomeDepot(url) {
  const html = await zenrowsFetch(url, { jsRender: true, antibot: true, wait: 3000 });

  if (html.length < 50000) {
    console.log(`[scraper-specialty] Home Depot: response too small (${html.length} bytes)`);
    return { price: null, stockStatus: null };
  }

  // Priority 1: Apollo state (most accurate, avoids promo text prices)
  let price = extractHomeDepotApolloPrice(html);

  // Priority 2: JSON-LD fallback
  if (price === null) {
    price = extractJsonLdPrice(html);
  }

  // Priority 3: DOM span pattern fallback
  if (price === null) {
    const spanMatch = html.match(/\$<\/span><span[^>]*>(\d+)<\/span><span[^>]*>\.<\/span><span[^>]*>(\d+)<\/span>/);
    if (spanMatch) {
      price = parseFloat(`${spanMatch[1]}.${spanMatch[2]}`);
    }
  }

  const stockStatus = detectStockFromHtml(html);
  return { price, stockStatus };
}

// ---------------------------------------------------------------------------
// Lowes — ZenRows (no wait param) + JSON-LD extraction.
// Akamai-protected. ZenRows with js_render works but wait=5000 causes 422.
// JSON-LD Product schema has the price embedded in SSR HTML.
// ---------------------------------------------------------------------------

function extractLowesProductId(url) {
  const match = url.match(/\/(\d{7,})$/);
  return match ? match[1] : null;
}

async function scrapeLowes(url) {
  // ZenRows with js_render but NO wait param (wait causes 422 on Lowes)
  const html = await zenrowsFetch(url, { jsRender: true, antibot: true });

  if (html.length < 50000) {
    console.log(`[scraper-specialty] Lowes: response too small (${html.length} bytes)`);
    return { price: null, stockStatus: null };
  }

  // Priority 1: JSON-LD (most reliable)
  let price = extractJsonLdPrice(html);

  // Priority 2: __PRELOADED_STATE__ extraction
  if (price === null) {
    const stateMatch = html.match(/window\['__PRELOADED_STATE__'\]\s*=\s*(\{[\s\S]*?\});/);
    if (stateMatch) {
      try {
        const state = JSON.parse(stateMatch[1]);
        const productId = extractLowesProductId(url);
        const detail = state?.productDetails?.[productId];
        price = detail?.location?.price?.pricingDataList?.[0]?.finalPrice ?? null;
        if (typeof price === 'string') price = parsePrice(price);
      } catch { /* skip */ }
    }
  }

  // Priority 3: Regex scan for price patterns
  if (price === null) {
    const matches = [...html.matchAll(/"(?:finalPrice|price|currentPrice)"\s*:\s*"?(\d+\.?\d{0,2})"?/g)];
    const prices = matches.map(m => parseFloat(m[1])).filter(p => p > 0.5 && p < 100000);
    if (prices.length) price = prices[0];
  }

  const stockStatus = detectStockFromHtml(html);
  return { price, stockStatus };
}

// ---------------------------------------------------------------------------
// Michaels — wreq-js direct fetch, JSON-LD extraction.
// The generic HTTP scraper already handles this (wreq-js returns 200 with
// JSON-LD Product schema). This is a thin wrapper for explicit routing.
// ---------------------------------------------------------------------------

async function scrapeMichaels(url) {
  const res = await wreqGet(url, {
    browser: 'chrome_131',
    os: 'windows',
    headers: { 'accept-language': 'en-US,en;q=0.9' },
  });

  if (!res.ok) throw new Error(`Michaels returned ${res.status}`);

  const html = await res.text();
  const price = extractJsonLdPrice(html);

  // Also try og:price:amount meta tag
  let finalPrice = price;
  if (finalPrice === null) {
    const $ = load(html);
    finalPrice = parsePrice($('meta[name="og:price:amount"]').attr('content'));
  }

  const stockStatus = detectStockFromHtml(html);
  return { price: finalPrice, stockStatus };
}
