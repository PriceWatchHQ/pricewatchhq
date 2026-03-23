import { load } from 'cheerio';
import { get as wreqGet } from 'wreq-js';

const PROXY_URL = 'http://435506cb74cfc28227b6:03e5b65830ff6bf2@gw.dataimpulse.com:823';

const domains = [
  { domain: 'bhphotovideo.com', url: 'https://www.bhphotovideo.com/c/product/1821539-REG/sony_ilce_7cm2_b_a7c_ii_mirrorless_camera.html' },
  { domain: 'gymshark.com', url: 'https://www.gymshark.com/products/gymshark-rest-day-hoodie-forest-green-ss25' },
  { domain: 'menards.com', url: 'https://www.menards.com/main/company-information/about-us/online-only-deals/2025-panini-trade-select-baseball-mega/2-18249-20/p-4654627767327736-c-1642874346487673.htm' },
  { domain: 'acehardware.com', url: 'https://www.acehardware.com/departments/outdoor-living/outdoor-power-equipment/lawn-mowers/7803025' },
  { domain: 'tjmaxx.tjx.com', url: 'https://tjmaxx.tjx.com/store/jump/product/Rose-Print-Mix-Rialto-Dress/1001141274' },
  { domain: 'hy-vee.com', url: 'https://www.hy-vee.com/aisles-online/p/10584/arm-and-hammer-double-duty-advanced-dual-odor-control-clumping-cat-litter' },
];

async function testDomain({ domain, url }, useProxy = false) {
  const label = useProxy ? `[${domain} +proxy]` : `[${domain}]`;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${label} Fetching: ${url}`);
  console.log(`Proxy: ${useProxy ? 'YES' : 'NO'}`);

  try {
    const opts = {
      browser: 'chrome_131',
      os: 'windows',
      headers: { 'accept-language': 'en-US,en;q=0.9' },
      ...(useProxy ? { proxy: PROXY_URL } : {}),
    };

    const res = await wreqGet(url, opts);
    console.log(`${label} Status: ${res.status} ${res.statusText}`);

    if (!res.ok) {
      console.log(`${label} RESULT: BLOCKED (HTTP ${res.status})`);
      return { domain, status: 'blocked', httpStatus: res.status, proxy: useProxy };
    }

    const html = await res.text();
    console.log(`${label} HTML length: ${html.length}`);

    // Check for bot detection
    if (html.length < 20000 && /captcha|robot|automated|unusual traffic/i.test(html)) {
      console.log(`${label} RESULT: BLOCKED (captcha/bot detection)`);
      return { domain, status: 'blocked', reason: 'captcha', proxy: useProxy };
    }

    const $ = load(html);

    // Check JSON-LD
    const jsonLdScripts = $('script[type="application/ld+json"]');
    console.log(`${label} JSON-LD scripts found: ${jsonLdScripts.length}`);

    let jsonLdPrice = null;
    let jsonLdData = null;
    for (let i = 0; i < jsonLdScripts.length; i++) {
      try {
        const data = JSON.parse($(jsonLdScripts[i]).html());
        const price = findPrice(data);
        if (price !== null) {
          jsonLdPrice = price;
          jsonLdData = data;
          break;
        }
        // Log types found
        logTypes(data, label);
      } catch (e) {
        console.log(`${label} JSON-LD parse error: ${e.message}`);
      }
    }

    if (jsonLdPrice !== null) {
      console.log(`${label} JSON-LD price: $${jsonLdPrice}`);
    }

    // Check itemprop="price"
    const itempropPrice = $('[itemprop="price"]').first();
    if (itempropPrice.length) {
      const val = itempropPrice.attr('content') || itempropPrice.text();
      console.log(`${label} itemprop="price": ${val}`);
    }

    // Check data-price
    const dataPrice = $('[data-price]').first();
    if (dataPrice.length) {
      console.log(`${label} data-price: ${dataPrice.attr('data-price')}`);
    }

    // Check meta product:price:amount
    const metaPrice = $('meta[property="product:price:amount"]').first();
    if (metaPrice.length) {
      console.log(`${label} meta product:price:amount: ${metaPrice.attr('content')}`);
    }

    // Check og:price
    const ogPrice = $('meta[property="og:price:amount"]').first();
    if (ogPrice.length) {
      console.log(`${label} og:price:amount: ${ogPrice.attr('content')}`);
    }

    // Check common price selectors
    const priceSelectors = ['.price', '[class*="price"]', '[class*="Price"]', '[data-testid*="price"]'];
    for (const sel of priceSelectors) {
      const el = $(sel).first();
      if (el.length) {
        const text = el.text().trim().substring(0, 100);
        if (text) {
          console.log(`${label} ${sel}: "${text}"`);
          break;
        }
      }
    }

    // Title for verification
    const title = $('title').text().trim().substring(0, 100);
    console.log(`${label} Page title: ${title}`);

    const works = jsonLdPrice !== null || itempropPrice.length > 0 || dataPrice.length > 0;
    console.log(`${label} RESULT: ${works ? 'WORKS' : 'NO PRICE FOUND'}`);

    return {
      domain,
      status: works ? 'works' : 'no-price',
      jsonLdPrice,
      hasItemprop: itempropPrice.length > 0,
      hasDataPrice: dataPrice.length > 0,
      title,
      htmlLength: html.length,
      proxy: useProxy,
    };
  } catch (err) {
    console.log(`${label} ERROR: ${err.message}`);
    return { domain, status: 'error', error: err.message, proxy: useProxy };
  }
}

function findPrice(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const p = findPrice(item);
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
      const raw = offer.price ?? offer.lowPrice ?? offer.highPrice;
      if (raw != null) {
        const num = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
        if (Number.isFinite(num) && num > 0) return num;
      }
    }
  }
  if (obj['@graph']) return findPrice(obj['@graph']);
  return null;
}

function logTypes(data, label) {
  if (Array.isArray(data)) {
    data.forEach(d => logTypes(d, label));
    return;
  }
  if (data && data['@type']) {
    console.log(`${label} JSON-LD @type: ${JSON.stringify(data['@type'])}`);
  }
  if (data && data['@graph']) {
    logTypes(data['@graph'], label);
  }
}

async function main() {
  console.log('=== Domain Research: Testing 6 domains with wreq-js Chrome 131 ===\n');

  // Test all without proxy first
  const results = await Promise.all(domains.map(d => testDomain(d, false)));

  // Retry blocked/failed ones with proxy
  const needProxy = results.filter(r => r.status !== 'works');
  if (needProxy.length > 0) {
    console.log(`\n\n${'#'.repeat(60)}`);
    console.log('### Retrying with DataImpulse proxy ###');
    console.log(`${'#'.repeat(60)}`);

    const proxyResults = await Promise.all(
      needProxy.map(r => testDomain(domains.find(d => d.domain === r.domain), true))
    );

    // Merge results
    for (const pr of proxyResults) {
      const idx = results.findIndex(r => r.domain === pr.domain);
      if (pr.status === 'works') results[idx] = pr;
      else results[idx].proxyResult = pr;
    }
  }

  console.log(`\n\n${'='.repeat(60)}`);
  console.log('=== SUMMARY ===');
  console.log(`${'='.repeat(60)}`);
  for (const r of results) {
    const proxyNote = r.proxy ? ' (with proxy)' : r.proxyResult ? ` → proxy: ${r.proxyResult.status}` : '';
    console.log(`${r.domain}: ${r.status}${proxyNote}${r.jsonLdPrice ? ` — $${r.jsonLdPrice}` : ''}`);
  }
}

main().catch(console.error);
