// Exact-SHA hosted Preview read-only acceptance preparation.
// This file is NOT a substitute for the OWNER Staging Approval Ledger.
// Default deny: do not run via generic Staging smoke without a new approval.
import { URL } from 'node:url';
import { expect, test } from '../fixtures/diagnostic-fixture.js';

const approval = process.env.NOVELIGHT_COMMUNITY_READONLY_APPROVED === '1';
const bypass = process.env.NOVELIGHT_COMMUNITY_PREVIEW_BYPASS || '';
const expectedSha = process.env.NOVELIGHT_COMMUNITY_EXPECTED_SHA || '';
const expectedSupabaseUrl =
  process.env.NOVELIGHT_COMMUNITY_EXPECTED_SUPABASE_URL || '';
const approvalCommentId =
  process.env.NOVELIGHT_COMMUNITY_STAGING_APPROVAL_ID || '';
const shaPattern = /^[0-9a-f]{40}$/;
const productionHosts = new Set([
  'novelight.jp',
  'www.novelight.jp',
  'novelrise.vercel.app',
  'fiepaguycecrredwrcwx.supabase.co'
]);

test.skip(
  !approval,
  'OWNER-approved, exact-SHA Staging read-only scope is required'
);

function requirePinnedPreview(baseURL) {
  if (
    !bypass ||
    !shaPattern.test(expectedSha) ||
    !/^[0-9]+$/.test(approvalCommentId)
  ) {
    throw new Error('Missing exact-SHA or one-use Staging approval reference.');
  }

  const preview = new URL(baseURL);
  const staging = new URL(expectedSupabaseUrl);
  if (
    preview.protocol !== 'https:' ||
    !preview.hostname.endsWith('.vercel.app') ||
    productionHosts.has(preview.hostname) ||
    staging.protocol !== 'https:' ||
    !staging.hostname.endsWith('.supabase.co') ||
    productionHosts.has(staging.hostname)
  ) {
    throw new Error('Refusing unsafe Preview or Supabase target.');
  }
  return { preview: preview.origin, staging: staging.origin };
}

test('Preview facts and admin denial', async ({ request, baseURL }) => {
  const targets = requirePinnedPreview(baseURL);
  const readPreview = (path) =>
    request.get(path, {
      maxRedirects: 0,
      headers: { 'x-vercel-protection-bypass': bypass }
    });
  const factsResponse = await readPreview('/api/staging-environment-facts');
  expect(factsResponse.status()).toBe(200);
  const facts = await factsResponse.json();
  expect(facts.vercelEnv).toBe('preview');
  expect(facts.commitSha).toBe(expectedSha);
  expect(facts.appBaseUrl).toBe(targets.preview);
  expect(facts.supabase.url).toBe(targets.staging);
  expect(facts.supabase.serverSecretPresent).toBe(true);
  expect(facts.supabase.publishableKeyClass).toMatch(
    /^(publishable|legacy-anon)$/
  );

  const browserConfig = await readPreview('/api/staging-browser-config');
  expect(browserConfig.status()).toBe(200);
  const config = await browserConfig.json();
  expect(new URL(config.supabaseUrl).origin).toBe(targets.staging);

  const admin = await readPreview('/api/admin-community');
  expect(admin.status()).toBe(401);
});

test('gated anonymous browser has no writes', async ({ page, baseURL }) => {
  const targets = requirePinnedPreview(baseURL);
  const violations = [];
  const allowedHosts = new Set([
    new URL(targets.preview).hostname,
    new URL(targets.staging).hostname
  ]);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method !== 'GET' && method !== 'HEAD') {
      // The page attempts first-party analytics on navigation. Block it too,
      // but only unexpected write attempts should fail this read-only proof.
      const blockedTelemetry =
        method === 'POST' &&
        url.origin === targets.preview &&
        url.pathname === '/api/analytics-event' &&
        !url.search &&
        !url.hash;
      if (!blockedTelemetry) {
        violations.push('non-read-only request: ' + method);
      }
      await route.abort('blockedbyclient');
      return;
    }
    if (productionHosts.has(url.hostname)) {
      violations.push('Production origin contact attempted');
      await route.abort('blockedbyclient');
      return;
    }
    if (!allowedHosts.has(url.hostname)) {
      // Other third-party assets are not required for this proof.
      await route.abort('blockedbyclient');
      return;
    }
    if (url.hostname === new URL(targets.preview).hostname) {
      await route.continue({
        headers: { ...request.headers(), 'x-vercel-protection-bypass': bypass }
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/community.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#communityPageHeading')).toBeVisible();
  await expect(page.locator('.community-card')).toHaveCount(0);
  const flags = await page.evaluate(() => globalThis.NOVELIGHT_COMMUNITY_FLAGS);
  expect(flags.timeline).toBe(false);
  expect(flags.board).toBe(false);
  expect(violations).toEqual([]);

  await page.goto('/admin-community.html', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/login\.html\?redirect=admin-community\.html/);
  expect(violations).toEqual([]);
});
