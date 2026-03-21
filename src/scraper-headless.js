import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

// Same selectors as scraper.js, plus extras for JS-rendered sites
const PRICE_SELECTORS = [
  '.price',
  '[class*="price"]',
  '[itemprop="price"]',
  '[data-price]',
  '[class*="Price"]',
  'span[class*="amount"]',
  '[data-testid*="price"]',
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

/**
 * Scrape price and stock status using a headless Chromium browser.
 * Designed for sites that block simple HTTP requests (Walmart, Best Buy, Target, etc.).
 * Uses @sparticuz/chromium for Railway/serverless compatibility.
 */
export async function scrapePriceAndStockHeadless(url) {
  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 });

    const result = await page.evaluate(
      ({ priceSelectors, stockSelectors }) => {
        // --- Price extraction ---
        let price = null;
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
          if (Number.isFinite(num) && num > 0) {
            price = num;
            break;
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
