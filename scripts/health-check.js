#!/usr/bin/env node
/**
 * Health check script — runs against a given base URL to verify the app is healthy.
 * Usage: node scripts/health-check.js https://pricewatchhq-staging.up.railway.app
 */

const BASE_URL = process.argv[2];
if (!BASE_URL) {
  console.error('Usage: node scripts/health-check.js <base-url>');
  process.exit(1);
}

const ADMIN_SECRET = 'pwh_admin_2026';
let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

async function assertStatus(url, expectedStatus = 200) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (r.status !== expectedStatus) throw new Error(`Expected ${expectedStatus}, got ${r.status}`);
  return r;
}

async function assertJson(url, validate) {
  const r = await assertStatus(url);
  const data = await r.json();
  if (validate) validate(data);
  return data;
}

console.log(`\n🔍 Health check: ${BASE_URL}\n`);

// 1. Server is up
await check('Server responds', () => assertStatus(`${BASE_URL}/`));

// 2. Auth endpoint works
await check('Auth /me returns 401 when unauthenticated', () =>
  assertStatus(`${BASE_URL}/api/auth/me`, 401)
);

// 3. Login endpoint accepts requests
await check('Login endpoint accepts POST', async () => {
  const r = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@pricewatchhq.com' }),
    signal: AbortSignal.timeout(10000),
  });
  if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
});

// 4. Admin endpoints work
await check('Admin demo-status responds', async () => {
  const r = await fetch(`${BASE_URL}/admin/demo-status?secret=${ADMIN_SECRET}`, 
    { signal: AbortSignal.timeout(10000) });
  if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
});

// 5. Pending domains endpoint works
await check('Admin pending-domains responds', async () => {
  const r = await fetch(`${BASE_URL}/admin/pending-domains?secret=${ADMIN_SECRET}`,
    { signal: AbortSignal.timeout(10000) });
  if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  const data = await r.json();
  if (!Array.isArray(data.pending)) throw new Error('pending is not an array');
});

// 6. Scraper smoke test (optional — only run if TEST_SCRAPE=true)
if (process.env.TEST_SCRAPE === 'true') {
  await check('Scraper returns price for Amazon URL', async () => {
    const url = encodeURIComponent('https://www.amazon.com/dp/B09B93ZDG4');
    const r = await fetch(`${BASE_URL}/admin/test-scrape?secret=${ADMIN_SECRET}&url=${url}`,
      { signal: AbortSignal.timeout(60000) });
    const data = await r.json();
    if (!data.result?.price) throw new Error(`No price returned: ${JSON.stringify(data)}`);
  });
}

console.log(`\n${passed + failed} checks — ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
