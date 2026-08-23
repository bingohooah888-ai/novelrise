import { expect, test } from '@playwright/test';

const publicPages = [
  ['home', '/index.html'],
  ['search', '/search.html'],
  ['pricing', '/pricing.html'],
  ['login', '/login.html'],
  ['signup', '/signup.html'],
  ['novel detail', '/novel.html']
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

test(
  'analytics exposes the exposure KPI shell without authentication',
  async ({ request }) => {
    const response = await request.get('/analytics.html');
    expect(response.ok()).toBeTruthy();

    const html = await response.text();
    expect(html).toContain('id="exposureSummary"');
    expect(html).toContain('id="exposurePeriodSwitcher"');
    expect(html).toContain('id="exposureNovelList"');
    expect(html).toContain('本文10秒閲覧');
    expect(html).not.toContain('本文読了');
  }
);
