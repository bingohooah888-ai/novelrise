// Hosted authenticated Community Phase 1 acceptance. NEVER runs by default.
// Only an OWNER one-use workflow may set the approval environment and provision
// separate synthetic accounts on a data-less isolated Supabase preview branch.
import { URL } from 'node:url';
import { expect, test } from '@playwright/test';
import { installHostedCommunityFlags } from './community-hosted-flag-bootstrap.mjs';

// A separately authenticated OWNER runner must validate the exact latest PR
// HEAD against the trusted reviewed-file manifest before setting this value.
const FEATURE_SHA = process.env.NOVELIGHT_HOSTED_EXPECTED_SHA || '';
const SHA = /^[a-f0-9]{40}$/u;
const PROD_REF = 'fiepaguycecrredwrcwx';
const SHARED_REF = 'wmlzjgvxgoyrovdhbqbg';
const REF = /^[a-z0-9]{20}$/u;

const enabled = process.env.NOVELIGHT_HOSTED_AUTH_WRITE_APPROVED === '1';
test.skip(!enabled, 'exact OWNER one-use hosted-write admission required');

function configuration() {
  const env = process.env;
  const ref = env.NOVELIGHT_HOSTED_ISOLATED_REF || '';
  const approvalId = env.NOVELIGHT_HOSTED_APPROVAL_ID || '';
  const preview = new URL(env.STAGING_BASE_URL || '');
  const api = new URL(env.NOVELIGHT_HOSTED_SUPABASE_URL || '');
  const keys = [
    'NOVELIGHT_HOSTED_AUTHOR_EMAIL',
    'NOVELIGHT_HOSTED_AUTHOR_PASSWORD',
    'NOVELIGHT_HOSTED_READER_EMAIL',
    'NOVELIGHT_HOSTED_READER_PASSWORD',
    'NOVELIGHT_HOSTED_ADMIN_EMAIL',
    'NOVELIGHT_HOSTED_ADMIN_PASSWORD',
    'NOVELIGHT_HOSTED_FIXTURE_TITLE',
    'NOVELIGHT_HOSTED_FIXTURE_POST_KEY',
    'VERCEL_AUTOMATION_BYPASS_SECRET'
  ];
  if (
    !REF.test(ref) ||
    [PROD_REF, SHARED_REF].includes(ref) ||
    !/^[1-9][0-9]*$/u.test(approvalId) ||
    !SHA.test(FEATURE_SHA) ||
    env.NOVELIGHT_HOSTED_AUTH_WRITE_APPROVED !== '1' ||
    preview.protocol !== 'https:' ||
    !preview.hostname.endsWith('.vercel.app') ||
    preview.hostname === 'novelrise.vercel.app' ||
    preview.pathname !== '/' ||
    preview.search ||
    preview.hash ||
    api.origin !== 'https://' + ref + '.supabase.co' ||
    keys.some((name) => !env[name])
  ) {
    throw new Error('HOSTED_COMMUNITY_BROWSER_DENIED: unsafe target');
  }
  return { ref, preview: preview.origin, staging: api.origin, env };
}

function protect(context, { preview, staging, env }) {
  const violations = [];
  const allow = new Set([preview, staging]);
  const bypass = env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return context
    .route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      const isWrite = method !== 'GET' && method !== 'HEAD';
      const path = url.pathname;
      const stagingWrite =
        url.origin === staging &&
        method === 'POST' &&
        (path.startsWith('/auth/v1/') ||
          path.startsWith('/rest/v1/rpc/novelight_community_'));
      const stagingPreflight = url.origin === staging && method === 'OPTIONS';
      const adminWrite =
        url.origin === preview &&
        method === 'POST' &&
        path === '/api/admin-community' &&
        !url.search;
      if (
        !allow.has(url.origin) ||
        (isWrite && !stagingWrite && !stagingPreflight && !adminWrite)
      ) {
        violations.push('blocked unexpected browser request');
        await route.abort('blockedbyclient');
        return;
      }
      if (url.origin === preview) {
        await route.continue({
          headers: {
            ...request.headers(),
            'x-vercel-protection-bypass': bypass
          }
        });
        return;
      }
      await route.continue();
    })
    .then(() => violations);
}

async function signIn(page, cfg, role, publishableKey) {
  const email = cfg.env['NOVELIGHT_HOSTED_' + role + '_EMAIL'];
  const password = cfg.env['NOVELIGHT_HOSTED_' + role + '_PASSWORD'];
  await page.goto('/community.html', { waitUntil: 'domcontentloaded' });
  const success = await page.evaluate(
    async ({ staging, publishableKey, email, password }) => {
      const client = globalThis.supabase.createClient(staging, publishableKey);
      const result = await client.auth.signInWithPassword({ email, password });
      return !result.error && Boolean(result.data.session?.user);
    },
    { staging: cfg.staging, publishableKey, email, password }
  );
  expect(success).toBe(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
}

async function isolatedContext(browser, cfg) {
  const context = await browser.newContext({ baseURL: cfg.preview });
  const violations = await protect(context, cfg);
  // Preview-only: the real site initializes the public release gate to OFF
  // in strict mode. Permit that OFF assignment while retaining the synthetic
  // hosted-test flag ON, rather than breaking novelight-client.js bootstrap.
  // The existing site Preview bootstrap independently rewrites Supabase
  // clients to /api/staging-browser-config; no Production API is permitted.
  await context.addInitScript(installHostedCommunityFlags);
  return { context, violations };
}

test('real isolated author/reader/admin sessions and moderation', async ({
  browser,
  request
}) => {
  const cfg = configuration();
  const factResponse = await request.get('/api/staging-environment-facts', {
    maxRedirects: 0
  });
  expect(factResponse.status()).toBe(200);
  const facts = await factResponse.json();
  expect(facts.vercelEnv).toBe('preview');
  expect(facts.commitSha).toBe(FEATURE_SHA);
  expect(facts.appBaseUrl).toBe(cfg.preview);
  expect(facts.supabase.url).toBe(cfg.staging);
  expect(facts.stripe.secretKeyMode).toBe('test');

  const configResponse = await request.get('/api/staging-browser-config', {
    maxRedirects: 0
  });
  expect(configResponse.status()).toBe(200);
  const config = await configResponse.json();
  expect(config.supabaseUrl).toBe(cfg.staging);
  expect(config.supabasePublishableKey).toBeTruthy();

  const guestResponse = await request.get('/api/admin-community', {
    maxRedirects: 0
  });
  expect(guestResponse.status()).toBe(401);

  const author = await isolatedContext(browser, cfg);
  const reader = await isolatedContext(browser, cfg);
  const admin = await isolatedContext(browser, cfg);
  try {
    const authorPage = await author.context.newPage();
    const readerPage = await reader.context.newPage();
    const adminPage = await admin.context.newPage();
    await signIn(authorPage, cfg, 'AUTHOR', config.supabasePublishableKey);
    await signIn(readerPage, cfg, 'READER', config.supabasePublishableKey);
    await signIn(adminPage, cfg, 'ADMIN', config.supabasePublishableKey);

    const title = cfg.env.NOVELIGHT_HOSTED_FIXTURE_TITLE;
    const key = cfg.env.NOVELIGHT_HOSTED_FIXTURE_POST_KEY;
    const card = readerPage.locator('.community-card').filter({
      hasText: title
    });
    await expect(card).toHaveCount(1);
    await card.getByRole('button', { name: 'いいね' }).click();
    await expect(card.getByRole('button', { name: 'いいね' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    await card.getByRole('button', { name: /コメント/u }).click();
    await card
      .getByRole('textbox', { name: 'コメント' })
      .fill('Hosted isolated synthetic reader comment');
    await card.getByRole('button', { name: '送信' }).click();
    await expect(card).toContainText(
      'Hosted isolated synthetic reader comment'
    );

    await authorPage.reload({ waitUntil: 'domcontentloaded' });
    await expect(authorPage.locator('#communityNotifications')).toBeVisible();

    readerPage.on('dialog', async (dialog) => {
      if (dialog.type() === 'prompt') {
        await dialog.accept('Hosted isolated report proof');
      } else {
        await dialog.accept();
      }
    });
    await card.getByRole('button', { name: '通報' }).click();
    await expect(card.getByRole('button', { name: '通報済み' })).toBeVisible();

    adminPage.on('dialog', async (dialog) => {
      await dialog.accept();
    });
    await adminPage.goto('/admin-community.html', {
      waitUntil: 'domcontentloaded'
    });
    await expect(adminPage.locator('#communityAdminContent')).toBeVisible();
    const reports = adminPage.locator('#communityReportRows');
    await expect(reports).toContainText(key);
    await reports.getByRole('button', { name: '非表示' }).first().click();
    await expect(adminPage.locator('#communityHiddenRows')).toContainText(key);
    await adminPage
      .locator('#communityHiddenRows')
      .getByRole('button', { name: '復元' })
      .first()
      .click();
    await expect(adminPage.locator('#communityHiddenRows')).not.toContainText(
      key
    );

    for (const entry of [author, reader, admin]) {
      expect(entry.violations).toEqual([]);
    }
  } finally {
    await author.context.close();
    await reader.context.close();
    await admin.context.close();
  }
});
