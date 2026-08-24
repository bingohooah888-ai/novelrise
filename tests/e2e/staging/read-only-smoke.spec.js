import { URL } from 'node:url';
import { expect, test } from '../fixtures/diagnostic-test.js';

const productionHost = 'novelrise.vercel.app';
const blockedWriteRpcs = new Set([
  'record_acquisition_touch',
  'record_beta_visit',
  'claim_user_acquisition',
  'record_reader_journey_event',
  'record_novel_impressions_v2',
  'record_neutral_search_impressions',
  'record_novel_exposure_conversion',
  'increment_novel_pv',
  'increment_episode_pv'
]);

async function suppressKnownWrites(page) {
  await page.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.includes('/rpc/') || request.method() === 'GET') {
      await route.continue();
      return;
    }

    await route.abort('blockedbyclient');
  });

  await page.route('**/rest/v1/rpc/**', async (route) => {
    const url = new URL(route.request().url());
    const rpcName = url.pathname.split('/').pop();

    if (!blockedWriteRpcs.has(rpcName)) {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: 'null'
    });
  });
}

test('staging target is HTTPS and not the production host', async ({
  baseURL
}) => {
  const url = new URL(baseURL);
  expect(url.protocol).toBe('https:');
  expect(url.hostname).not.toBe(productionHost);
});

test('beta-critical public routes are deployed', async ({ request }) => {
  const routes = [
    '/index.html',
    '/search.html',
    '/pricing.html',
    '/signup.html',
    '/login.html',
    '/forgot-password.html',
    '/reset-password.html',
    '/novel.html',
    '/episode.html',
    '/post.html',
    '/episode-post.html',
    '/favorites.html',
    '/scout-record.html',
    '/analytics.html',
    '/mypage.html',
    '/terms.html',
    '/privacy.html',
    '/content-guidelines.html',
    '/billing-policy.html',
    '/commerce-disclosure.html',
    '/contact.html'
  ];

  for (const route of routes) {
    const response = await request.get(route, { maxRedirects: 0 });
    expect(response.status(), `${route} should be deployed`).toBe(200);
    const html = await response.text();
    expect(html, `${route} should expose a viewport`).toContain(
      '<meta name="viewport"'
    );
    expect(html, `${route} should use NOVELIGHT branding`).not.toMatch(
      /NovelRise|NOVELRISE/
    );
  }
});

test('safe API contracts respond without state-changing requests', async ({
  request
}) => {
  const checkout = await request.get('/api/create-checkout-session');
  expect([401, 405]).toContain(checkout.status());

  const portal = await request.get('/api/create-billing-portal-session');
  expect([401, 405]).toContain(portal.status());

  const webhook = await request.get('/api/stripe-webhook');
  expect(webhook.status()).toBe(405);
});

test('reader discovery flow renders while measurement writes are suppressed', async ({
  page
}) => {
  await suppressKnownWrites(page);

  await page.goto('/search.html', { waitUntil: 'domcontentloaded' });
  const resultCount = page.locator('#resultCount');
  await expect(resultCount).not.toHaveText('読み込み中...', {
    timeout: 20_000
  });
  await expect(resultCount).not.toHaveText('読み込みエラー');

  const cards = page.locator('.novel-card');
  if ((await cards.count()) === 0) {
    await expect(page.locator('body')).toContainText(/作品|検索/);
    return;
  }

  const novelHref = await cards.first().getAttribute('href');
  expect(novelHref).toBeTruthy();
  await page.goto(novelHref, { waitUntil: 'domcontentloaded' });

  const warningGate = page.locator('#warningGate.visible');
  if (await warningGate.isVisible().catch(() => false)) {
    await page.locator('#continueButton').click();
  }

  await expect(page.locator('#novelHeader')).not.toContainText(
    '読み込み中...',
    { timeout: 20_000 }
  );
});
