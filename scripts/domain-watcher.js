#!/usr/bin/env node
/**
 * domain-watcher.js — polls Railway for pending domains and spawns research agents
 * Run via: node scripts/domain-watcher.js
 * Or cron: set up via openclaw cron add
 */
import 'dotenv/config';
import { execSync } from 'child_process';

const RAILWAY_BASE = 'https://pricewatchhq-production.up.railway.app';
const ADMIN_SECRET = 'pwh_admin_2026';
const PROJECT_DIR = '/home/skyler/projects/pricewatchhq';

async function fetchJson(url) {
  const res = await fetch(url);
  return res.json();
}

async function main() {
  console.log('[domain-watcher] Checking for pending domains...');

  const { pending, count } = await fetchJson(
    `${RAILWAY_BASE}/admin/pending-domains?secret=${ADMIN_SECRET}`
  );

  if (count === 0) {
    console.log('[domain-watcher] No pending domains. All good.');
    return;
  }

  console.log(`[domain-watcher] Found ${count} pending domain(s): ${pending.map(d => d.domain).join(', ')}`);

  // Mark all as 'researching' so we don't double-spawn
  for (const { domain } of pending) {
    await fetch(`${RAILWAY_BASE}/admin/domain-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: ADMIN_SECRET, domain, status: 'researching' }),
    });
  }

  // Build the prompt for Claude Code
  const domainList = pending.map(d => `- ${d.domain}`).join('\n');

  const prompt = `You are a scraper research and implementation agent for PriceWatchHQ.

## Your Task
Research and implement price + stock scraping support for these new store domains:
${domainList}

## Steps for EACH domain:

1. **Research the site structure** — fetch the product page HTML and find price/stock selectors
   Use wreq-js or fetch to get a sample product page HTML:
   \`\`\`js
   import { get } from 'wreq-js';
   const r = await get(url, { browser: 'chrome_131', os: 'windows' });
   const html = await r.text();
   \`\`\`

2. **Find price selectors** — look for:
   - Schema.org: \`[itemprop="price"]\` or \`[itemprop="offers"]\`
   - JSON-LD: \`<script type="application/ld+json">\` with price data
   - Common patterns: \`[class*="price"]\`, \`[data-price]\`, \`[class*="Price"]\`
   - Site-specific patterns in the HTML

3. **Find stock selectors** — look for:
   - Add to cart buttons
   - Out of stock text
   - Availability schema.org markup

4. **Implement support** in src/scraper-retail.js:
   - Add the domain to the RETAILER_CONFIGS object (or similar structure)
   - If the site requires JS rendering (React/Vue SPA), mark it as needing Playwright
   - If plain HTTP works, add cheerio/HTML extraction support

5. **Test it** — run a quick test against a real URL to confirm prices come back

6. **Mark domain status** on Railway after each domain:
   \`\`\`js
   await fetch('${RAILWAY_BASE}/admin/domain-status', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       secret: '${ADMIN_SECRET}',
       domain: 'homedepot.com',
       status: 'supported',  // or 'unsupported' if anti-bot is impenetrable
       scraperType: 'playwright',  // or 'generic' or 'custom'
       notes: 'Uses schema.org price markup, needs JS render'
     })
   });
   \`\`\`

## Sample URLs to test with (from the actual tracked URLs):
- scheels.com: https://www.scheels.com/p/84382914305
- michaels.com: https://www.michaels.com/product/bandai-mg-gundam-verka-uc0093-mobile-suit-model-kit-10751365
- hobbylobby.com: https://www.hobbylobby.com/art-supplies/art-sets/mixed-media-art-set---143-piece-set/p/80930712
- homedepot.com: https://www.homedepot.com/p/DEWALT-20V-MAX-XR-Lithium-Ion-Electric-Cordless-18-Gauge-Brad-Nailer-Tool-Only-DCN680B/302029641
- lowes.com: https://www.lowes.com/pd/Whirlpool-3-5-cu-ft-High-Efficiency-Top-Load-Washer-White-While-Supplies-Last/1000064061
- gamestop.com: https://www.gamestop.com/toys-games/trading-cards/products/pokemon-trading-card-game-destined-rivals-booster-bundle/424446.html
- academy.com: https://www.academy.com/p/asics-mens-gel-numbus-28-running-shoes
- menards.com: https://www.menards.com/main/company-information/about-us/online-only-deals/2025-panini-trade-select-baseball-mega/2-18249-20/p-4654627767327736-c-1642874346487673.htm
- tjmaxx.tjx.com: https://tjmaxx.tjx.com/store/jump/product/Rose-Print-Mix-Rialto-Dress/1001141274
- hy-vee.com: https://www.hy-vee.com/aisles-online/p/10584/arm-and-hammer-double-duty-advanced-dual-odor-control-clumping-cat-litter
- acehardware.com: (find a sample URL if needed)
- gymshark.com: (find a sample URL if needed)
- bhphotovideo.com: (find a sample URL if needed)

## After all domains are done:
1. Commit and push: git add -A && git commit -m "feat: add scraper support for [list domains]" && git push
2. Run: openclaw system event --text "New store scrapers implemented: [list domains that now work]. Railway will pick up on next scrape cycle." --mode now`;

  // Spawn Claude Code agent
  const claudeCmd = `cd ${PROJECT_DIR} && claude --permission-mode bypassPermissions --print ${JSON.stringify(prompt)}`;
  
  console.log('[domain-watcher] Spawning Claude Code research agent...');
  
  try {
    const output = execSync(claudeCmd, { 
      maxBuffer: 50 * 1024 * 1024,
      timeout: 600000,
      encoding: 'utf8'
    });
    console.log('[domain-watcher] Agent output:', output.slice(-500));
  } catch (err) {
    console.error('[domain-watcher] Agent error:', err.message?.slice(0, 200));
  }

  console.log('[domain-watcher] Done.');
}

main().catch(err => console.error('[domain-watcher] Fatal:', err.message));
