import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const pages = [
  'index.html',
  'signup.html',
  'login.html',
  'mypage.html',
  'post.html',
  'my-novels.html',
  'favorites.html',
  'pricing.html',
  'billing-success.html',
  'novel.html',
  'episode.html',
  'search.html',
  'ranking.html',
  'author.html',
  'analytics.html',
  'terms.html',
  'privacy.html',
  'content-guidelines.html',
  'billing-policy.html',
  'commerce-disclosure.html',
  'contact.html'
];

for (const file of pages) {
  test(`${file} loads without obvious server failure`, async ({ page }) => {
    const response = await page.goto(`/${file}`);
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
  });
}

test('signup keeps terms acceptance and plan handoff', async ({ page }) => {
  await page.goto('/signup.html?plan=standard');
  await expect(page.locator('#planField')).toHaveValue('standard');
  await expect(page.locator('#termsAccepted')).toBeVisible();
  await expect(page.locator('a[href="terms.html"]')).toBeVisible();
  await expect(page.locator('a[href="privacy.html"]')).toBeVisible();
});

test('billing return pages expose clear next steps', async ({ request }) => {
  const [success, pricing] = await Promise.all([
    request.get('/billing-success.html'),
    request.get('/pricing.html')
  ]);
  const successHtml = await success.text();
  const pricingHtml = await pricing.text();

  expect(successHtml).toContain('mypage.html');
  expect(pricingHtml).toContain('billing-policy.html');
  expect(pricingHtml).toContain('commerce-disclosure.html');
  expect(pricingHtml).toContain('11,760円');
  expect(pricingHtml).toContain('23,760円');
  expect(pricingHtml).toContain('自動更新');
});

test('public pages expose legal and reporting paths', async ({ request }) => {
  const [home, novel, episode] = await Promise.all([
    request.get('/index.html').then((response) => response.text()),
    request.get('/novel.html').then((response) => response.text()),
    request.get('/episode.html').then((response) => response.text())
  ]);

  for (const href of [
    'terms.html',
    'privacy.html',
    'content-guidelines.html',
    'billing-policy.html',
    'commerce-disclosure.html',
    'contact.html'
  ]) {
    expect(home).toContain(href);
  }
  expect(novel).toContain('submit_content_report');
  expect(episode).toContain('submit_content_report');
});

test('analytics exposes the beta funnel and named paid surfaces', async ({
  request
}) => {
  const html = await (await request.get('/analytics.html')).text();
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
    '/mypage.html',
    '/post.html',
    '/my-novels.html',
    '/favorites.html',
    '/pricing.html',
    '/billing-success.html',
    '/novel.html',
    '/episode.html',
    '/search.html',
    '/ranking.html',
    '/author.html',
    '/analytics.html',
    '/terms.html',
    '/privacy.html',
    '/content-guidelines.html',
    '/billing-policy.html',
    '/commerce-disclosure.html',
    '/contact.html'
  ];

  for (const route of routes) {
    await page.goto(route);
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(metrics.scrollWidth, route).toBeLessThanOrEqual(metrics.clientWidth);
  }

  await context.close();
});
