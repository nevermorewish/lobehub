import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Run against a built deployment with a test user's session cookie file.
// In particular, this catches static SPA shells that fail when the runtime
// ADMIN_SERVICE_URL is configured only after the Docker image was built.
const origin = process.env.BILLING_SMOKE_URL ?? 'http://localhost:3220';
const cookieFile = process.env.BILLING_SMOKE_COOKIE_FILE;
assert(cookieFile, 'Set BILLING_SMOKE_COOKIE_FILE to an authenticated test session cookie file');
const cookie = (await readFile(cookieFile, 'utf8')).trim();

for (const path of ['/settings/credits', '/settings/plans', '/settings/billing', '/settings/usage']) {
  const response = await fetch(new URL(path, origin), {
    headers: { Cookie: cookie },
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200, `${path} must render for an authenticated user`);
  const html = await response.text();
  assert(html.includes('enableCreditBilling'), `${path} must include runtime billing configuration`);
  console.info(`PASS ${path}: runtime billing shell is available`);
}
