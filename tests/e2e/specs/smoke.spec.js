import { expect, test } from '@playwright/test';

const publicPages = [
  ['home', '/index.html'],
  ['search', '/search.html'],
  ['pricing', '/pricing.html'],
  ['login', '/login.html'],
  ['signup', '/signup.html'],
  ['novel detail', '/novel.html'],
  ['terms', '/terms.html'],
  ['privacy', '/privacy.html'],
  ['content guidelines', '/content-guidelines.html'],
  ['billing policy', '/billing-policy.html'],
  ['commerce disclosure', '/commerce-disclosure.html']
];

for (const [name, path] of publicPages) {
  test(`${name} page renders`, async ({ page }) => {
    const response = await page.goto(path, {
      waitUntil: 'domcontentloaded'
    });

    expect(response).not.toBeNull();
    expect(response.ok()).toBeTruthy();
    await expect(page.locator('body')).toBeVisible();
    expect((await page.title()).trim()).not.toBe('');
  });
}

test('home exposes the discovery feed shell', async ({ page }) => {
  await page.goto('/index.html', {
    waitUntil: 'domcontentloaded'
  });

  await expect(page.locator('#discoveryGrid')).toHaveCount(1);
  await expect(page.locator('#premiumWrap')).toHaveCount(1);
  await expect(
    page.getByText('Free / Standard / Premium すべてが一般枠の対象です')
  ).toHaveCount(1);
});

test('search exposes recommended and neutral sorts', async ({ page }) => {
  await page.goto('/search.html', {
    waitUntil: 'domcontentloaded'
  });

  await expect(page.locator('#keywordInput')).toHaveCount(1);
  await expect(page.locator('#genreSelect')).toHaveCount(1);
  await expect(page.locator('#sortSelect')).toHaveCount(1);

  const values = await page
    .locator('#sortSelect option')
    .evaluateAll((options) => options.map((option) => option.value));

  expect(values).toEqual(['recommended', 'new', 'pv', 'favorites']);
});

test('login form exposes the required controls', async ({ page }) => {
  await page.goto('/login.html', {
    waitUntil: 'domcontentloaded'
  });

  await expect(page.locator('#email')).toBeVisible();
  await expect(page.locator('#password')).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeVisible();
});

test('novel detail includes the LIGHT SEED UI shell', async ({ page }) => {
  await page.goto('/novel.html', {
    waitUntil: 'domcontentloaded'
  });

  await expect(page.locator('#lightSeedArea')).toHaveCount(1);
  await expect(page.locator('#lightSeedButton')).toHaveCount(1);
  await expect(page.locator('#lightSeedRemaining')).toHaveCount(1);
});

test('analytics exposes the exposure KPI shell without authentication', async ({
  request
}) => {
  const response = await request.get('/analytics.html');
  expect(response.ok()).toBeTruthy();

  const html = await response.text();
  expect(html).toContain('id="exposureSummary"');
  expect(html).toContain('id="exposurePeriodSwitcher"');
  expect(html).toContain('id="exposureNovelList"');
  expect(html).toContain('本文10秒閲覧');
  expect(html).toContain('第1話→第2話 継続率');
  expect(html).toContain('露出後のお気に入り');
  expect(html).not.toContain('本文読了');
});

test('author dashboard exposes beta author KPI shell', async ({ request }) => {
  const response = await request.get('/mypage.html');
  expect(response.ok()).toBeTruthy();

  const html = await response.text();
  expect(html).toContain('<title>作者ダッシュボード | NOVELIGHT</title>');
  expect(html).toContain('id="authorExposureSummary"');
  expect(html).toContain('id="authorStats"');
  expect(html).toContain('id="receivedFavoriteCount"');
  expect(html).toContain('第1話10秒閲覧');
  expect(html).toContain('第2話まで継続');
  expect(html).toContain('露出後のお気に入り');
  expect(html).toContain('novelight_author_exposure_funnel');
  expect(html).not.toContain('NovelRise');
});

test('author dashboard starts without JavaScript page errors', async ({
  page
}) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/mypage.html', {
    waitUntil: 'domcontentloaded'
  });
  await page.waitForTimeout(750);

  expect(pageErrors).toEqual([]);
});

test('reader pages wire exposure conversion recording', async ({ request }) => {
  const novelResponse = await request.get('/novel.html');
  expect(novelResponse.ok()).toBeTruthy();
  const novelHtml = await novelResponse.text();
  expect(novelHtml).toContain('record_novel_exposure_conversion');
  expect(novelHtml).toContain("p_event_type: 'detail_open'");
  expect(novelHtml).toContain("p_event_type: 'favorite_added'");
  expect(novelHtml).toContain('novelight_visitor_token');

  const episodeResponse = await request.get('/episode.html');
  expect(episodeResponse.ok()).toBeTruthy();
  const episodeHtml = await episodeResponse.text();
  expect(episodeHtml).toContain('record_novel_exposure_conversion');
  expect(episodeHtml).toContain("'episode_read_10s'");
  expect(episodeHtml).toContain("'visibilitychange'");
});
