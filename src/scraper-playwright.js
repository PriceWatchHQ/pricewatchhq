import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

// DataImpulse residential proxy
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

const STOCK_SELECTORS = [
  '#availability',
  '[class*="avail"]',
  '[class*="stock"]',
  '[id*="stock"]',
  '[data-availability]',
  '[data-testid*="fulfillment"]',
  '[class*="fulfillment"]',
];

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Scrape price and stock status using Playwright with stealth plugin.
 * Routes traffic through DataImpulse residential proxy when PROXY_URL is set.
 * Designed for anti-bot sites like Walmart, Best Buy, and Target.
 */
export async function scrapePriceAndStockPlaywright(url) {
  const launchOptions = {
    headless: true,
  };

  if (PROXY_URL) {
    const proxyUrl = new URL(PROXY_URL);
    launchOptions.proxy = {
      server: `${proxyUrl.protocol}//${proxyUrl.hostname}:${proxyUrl.port}`,
      username: proxyUrl.username || undefined,
      password: proxyUrl.password || undefined,
    };
  }

  let browser = null;
  try {
    browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
    });

    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });

    const result = await page.evaluate(
      ({ priceSelectors, stockSelectors }) => {
        // --- Price extraction ---
        let price = null;

        // Try JSON-LD structured data first (most reliable for retail sites)
        const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of ldScripts) {
          try {
            const data = JSON.parse(script.textContent);
            const items = Array.isArray(data) ? data : (data['@graph'] || [data]);
            for (const item of items) {
              const type = item['@type'];
              if (type === 'Product' || type === 'IndividualProduct' ||
                  (Array.isArray(type) && (type.includes('Product') || type.includes('IndividualProduct')))) {
                const offers = item.offers;
                if (offers) {
                  const offerList = Array.isArray(offers) ? offers : [offers];
                  for (const offer of offerList) {
                    const rawP = offer.price ?? offer.lowPrice ?? offer.highPrice;
                    if (rawP != null) {
                      const n = parseFloat(String(rawP).replace(/[^0-9.]/g, ''));
                      if (Number.isFinite(n) && n > 0 && n <= 100000) { price = n; break; }
                    }
                  }
                }
              }
              if (price !== null) break;
            }
          } catch {}
          if (price !== null) break;
        }

        // Fall back to CSS selectors
        if (price === null) {
          for (const sel of priceSelectors) {
            const el = document.querySelector(sel);
            if (!el) continue;
            const raw =
              el.getAttribute('content') ||
              el.getAttribute('data-price') ||
              el.textContent;
            if (!raw) continue;
            const cleaned = raw.replace(/[^0-9.,]/g, '').replace(/,/g, '');
            const num = parseFloat(cleaned);
            if (Number.isFinite(num) && num > 0 && num <= 100000) {
              price = num;
              break;
            }
          }
        }

        // --- Stock status extraction ---
        let stockStatus = null;

        // Schema.org microdata
        const availMeta = document.querySelector('[itemprop="availability"]');
        if (availMeta) {
          const val = (
            availMeta.getAttribute('href') ||
            availMeta.getAttribute('content') ||
            availMeta.textContent
          ).toLowerCase();
          if (val.includes('instock') || val.includes('in_stock'))
            stockStatus = 'in_stock';
          else if (val.includes('outofstock') || val.includes('out_of_stock'))
            stockStatus = 'out_of_stock';
        }

        // CSS selectors for stock text
        if (!stockStatus) {
          for (const sel of stockSelectors) {
            const el = document.querySelector(sel);
            if (!el) continue;
            const text = (
              el.getAttribute('data-availability') || el.textContent
            )
              .toLowerCase()
              .trim();
            if (!text) continue;
            if (
              /out of stock|sold out|unavailable|currently unavailable|not available/.test(
                text
              )
            ) {
              stockStatus = 'out_of_stock';
              break;
            }
            if (
              /in stock|in-stock|available|add to cart|ships from/.test(text)
            ) {
              stockStatus = 'in_stock';
              break;
            }
          }
        }

        // Add-to-cart button as fallback signal
        if (!stockStatus) {
          const buttons = document.querySelectorAll(
            'button, input[type="submit"], [role="button"]'
          );
          for (const btn of buttons) {
            const t = btn.textContent.toLowerCase();
            if (
              t.includes('add to cart') ||
              t.includes('add to basket') ||
              t.includes('buy now')
            ) {
              stockStatus = 'in_stock';
              break;
            }
          }
        }

        return { price, stockStatus };
      },
      { priceSelectors: PRICE_SELECTORS, stockSelectors: STOCK_SELECTORS }
    );

    return result;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
