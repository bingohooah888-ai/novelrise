import { expect, test } from '../fixtures/diagnostic-fixture.js';

const publicPages = [
  ['home', '/index.html'],
  ['search', '/search.html'],
  ['ranking', '/ranking.html'],
  ['pricing', '/pricing.html'],
  ['login', '/login.html'],
  ['signup', '/signup.html'],
  ['forgot password', '/forgot-password.html'],
  ['reset password', '/reset-password.html'],
  ['novel detail', '/novel.html'],
  ['episode', '/episode.html'],
  ['author', '/author.html'],
  ['terms', '/terms.html'],
  ['privacy', '/privacy.html'],
  ['content guidelines', '/content-guidelines.html'],
  ['billing policy', '/billing-policy.html'],
  ['commerce disclosure', '/commerce-disclosure.html'],
  ['contact', '/contact.html']
];

async function readFontSize(locator) {
  return locator.evaluate((element) =>
    Number.parseFloat(globalThis.getComputedStyle(element).fontSize)
  );
}

for (const [name, path] of publicPages) {
  test(`${name} page renders`, async ({ request }) => {
    const response = await request.get(path);
    expect(response.ok()).toBeTruthy();
    const html = await response.text();
    expect(html).toContain('<meta name="viewport"');
    expect(html).toMatch(/<title>[^<]+<\/title>/);
  });
}

test('auth pages expose password recovery and no dummy forgot-password link', async ({
  request
}) => {
  const login = await (await request.get('/login.html')).text();
  const forgot = await (await request.get('/forgot-password.html')).text();
  const reset = await (await request.get('/reset-password.html')).text();

  expect(login).toContain('href="forgot-password.html"');
  expect(login).toContain('safeRedirectTarget');
  expect(forgot).toContain('resetPasswordForEmail');
  expect(reset).toContain('updateUser({password})');
});

test('posting shell requires classification and policy acknowledgement', async ({
  request
}) => {
  const post = await (await request.get('/post.html')).text();
  expect(post).toContain('id="aiUsage"');
  expect(post).toContain('id="contentRating"');
  expect(post).toContain('id="warningGrid"');
  expect(post).toContain('id="policyAck"');
});

test('reader pages expose zoning, report, and beta measurement hooks', async ({
  request
}) => {
  const novel = await (await request.get('/novel.html')).text();
  const episode = await (await request.get('/episode.html')).text();

  expect(novel).toContain('id="warningGate"');
  expect(novel).toContain('submit_content_report');
  expect(novel).toContain("'detail_open'");
  expect(novel).toContain("'favorite_added'");
  expect(novel).toContain("'light_seed'");

  expect(episode).toContain('id="warning"');
  expect(episode).toContain('submit_content_report');
  expect(episode).toContain("'episode_read_10s'");
  expect(episode).toContain("'visibilitychange'");
});

test('LIGHT ANALYTICS exposes the beta funnel and plan-only exposure', async ({
  request
}) => {
  const html = await (await request.get('/analytics.html')).text();

  expect(html).toContain('<title>LIGHT ANALYTICS | NOVELIGHT</title>');
  expect(html).toContain('作品ページ→第1話');
  expect(html).toContain('第1話→第2話');
  expect(html).toContain('露出後お気に入り');
  expect(html).toContain('plan_extra_impressions');
  expect(html).toContain('novelight_author_exposure_funnel_v2');
  expect(html).not.toContain('LIGHT REPORT');
});

test('home and search use trusted discovery and complete impression tracking', async ({
  request
}) => {
  const home = await (await request.get('/index.html')).text();
  const search = await (await request.get('/search.html')).text();

  expect(home).toContain('novelight_trusted_discovery_feed');
  expect(home).toContain('novelight_trusted_plan_extra_feed');
  expect(home).toContain('record_trusted_allocation_receipts');
  expect(search).toContain('record_neutral_search_impressions');
  expect(search).toContain('record_trusted_allocation_receipts');
});

test('pricing desktop layout stays compact, readable, and single-row', async ({
  browser
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    javaScriptEnabled: false
  });
  const page = await context.newPage();
  const response = await page.goto('/pricing.html', {
    waitUntil: 'domcontentloaded'
  });
  expect(response?.ok()).toBeTruthy();

  const header = await page.locator('.public-header-inner').boundingBox();
  const logo = await page.locator('.logo').boundingBox();
  const nav = await page.locator('.desktop-nav').boundingBox();
  const actions = await page.locator('.header-actions').boundingBox();
  expect(header).not.toBeNull();
  expect(logo).not.toBeNull();
  expect(nav).not.toBeNull();
  expect(actions).not.toBeNull();
  expect(header.height).toBeLessThanOrEqual(100);

  const centers = [logo, nav, actions].map(
    (box) => box.y + box.height / 2
  );
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(12);

  const hero = await page.locator('.pricing-hero').boundingBox();
  expect(hero).not.toBeNull();
  expect(hero.height).toBeLessThan(250);

  const subFont = await readFontSize(page.locator('.pricing-sub'));
  expect(subFont).toBeGreaterThanOrEqual(16);

  const firstFeature = page.locator('.pricing-card .features li').first();
  const featureFont = await readFontSize(firstFeature);
  expect(featureFont).toBeGreaterThanOrEqual(14);

  const ribbon = await page.locator('.recommendation-ribbon').boundingBox();
  const emblem = await page.locator('.standard .plan-emblem').boundingBox();
  expect(ribbon).not.toBeNull();
  expect(emblem).not.toBeNull();
  expect(ribbon.y + ribbon.height).toBeLessThanOrEqual(emblem.y - 4);

  const cards = page.locator('.pricing-card');
  const cardHeights = await cards.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().height)
  );
  expect(Math.max(...cardHeights)).toBeLessThan(700);

  await context.close();
});

test('all audited major routes fit a 390px mobile viewport', async ({
  browser
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    javaScriptEnabled: false
  });
  const page = await context.newPage();
  const routes = [
    '/index.html',
    '/signup.html',
    '/login.html',
    '/search.html',
    '/novel.html',
    '/episode.html',
    '/post.html',
    '/episode-post.html',
    '/favorites.html',
    '/scout-record.html',
    '/analytics.html',
    '/mypage.html',
    '/pricing.html'
  ];

  for (const path of routes) {
    const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
    expect(response?.ok(), `${path} should load`).toBeTruthy();
    const overflow = await page.locator('html').evaluate((html) => ({
      scrollWidth: html.scrollWidth,
      clientWidth: html.clientWidth
    }));
    expect(
      overflow.scrollWidth,
      `${path} horizontally overflows: ${JSON.stringify(overflow)}`
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);
  }

  await context.close();
});
