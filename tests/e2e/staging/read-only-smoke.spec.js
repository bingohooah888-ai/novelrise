import { URL } from 'node:url';
import { expect, test } from '../fixtures/diagnostic-fixture.js';

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
    '/ranking.html',
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

test('browser security headers are active on deployed pages', async ({
  request
}) => {
  const response = await request.get('/index.html');
  const headers = response.headers();

  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['permissions-policy']).toContain('camera=()');
  expect(headers['content-security-policy']).toContain(
    "frame-ancestors 'none'"
  );
  expect(headers['content-security-policy']).toContain("object-src 'none'");
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

test('reader discovery, neutral search, ranking and novel detail render while writes are suppressed', async ({
  page
}) => {
  await suppressKnownWrites(page);

  await page.goto('/search.html', { waitUntil: 'domcontentloaded' });
  const resultCount = page.locator('#resultCount');
  await expect(resultCount).not.toHaveText('読み込み中...', {
    timeout: 20_000
  });
  await expect(resultCount).not.toHaveText('読み込みエラー');

  await page.locator('#sortSelect').selectOption('new');
  await expect(resultCount).not.toHaveText('読み込み中...', {
    timeout: 20_000
  });
  await expect(resultCount).not.toHaveText('読み込みエラー');

  const cards = page.locator('.novel-card');
  let novelHref = null;
  if ((await cards.count()) > 0) {
    novelHref = await cards.first().getAttribute('href');
    expect(novelHref).toBeTruthy();
  }

  await page.goto('/ranking.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#list')).not.toContainText('読み込み中...', {
    timeout: 20_000
  });
  await expect(page.locator('#list')).not.toContainText(
    '正しく計算できませんでした'
  );
  await page.locator('.tab[data-type="favorites"]').click();
  await expect(page.locator('#list')).not.toContainText('読み込み中...', {
    timeout: 20_000
  });
  await expect(page.locator('#list')).not.toContainText(
    '正しく計算できませんでした'
  );

  if (!novelHref) {
    await expect(page.locator('body')).toContainText(/作品|ランキング/);
    return;
  }

  await page.goto(novelHref, { waitUntil: 'domcontentloaded' });

  const warningGate = page.locator('#warningGate.visible');
  if (await warningGate.isVisible().catch(() => false)) {
    await page.locator('#continueButton').click();
  }

  await expect(page.locator('#novelHeader')).not.toContainText(
    '読み込み中...',
    { timeout: 20_000 }
  );
  await expect(page.locator('#favoriteCount')).not.toHaveText('—', {
    timeout: 20_000
  });
  await expect(page.locator('#authorName')).not.toHaveText(
    '作者情報を確認中...',
    { timeout: 20_000 }
  );
});
