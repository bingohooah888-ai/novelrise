import { expect, test } from '../fixtures/diagnostic-fixture.js';

const homeLabels = [
  'ホーム',
  '作品を探す',
  'ランキング',
  '特徴',
  '料金プラン',
  'ログイン'
];
const pricingLabels = [
  'ホーム',
  '作品を探す',
  'ランキング',
  '特徴',
  '料金プラン',
  '作者ホーム'
];
const publicMenus = [
  ['home', '/index.html', homeLabels],
  ['pricing', '/pricing.html', pricingLabels]
];

for (const [name, path, expectedLabels] of publicMenus) {
  test(`${name} mobile menu exposes visible clickable navigation items`, async ({
    browser
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      javaScriptEnabled: false
    });
    const page = await context.newPage();

    const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
    expect(response?.ok(), `${path} should load`).toBeTruthy();

    const menu = page.locator('details.mobile-menu');
    const summary = menu.locator('summary');
    const nav = menu.locator(':scope > nav');

    await expect(summary).toBeVisible();
    await summary.click();
    await expect(menu).toHaveAttribute('open', '');
    await expect(nav).toBeVisible();

    const links = nav.locator('a');
    await expect(links).toHaveCount(expectedLabels.length);
    await expect(links).toHaveText(expectedLabels);

    const firstLink = links.first();
    const topmost = await firstLink.evaluate((link) => {
      const rect = link.getBoundingClientRect();
      const point = link.ownerDocument.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2
      );
      return point === link || link.contains(point);
    });
    expect(
      topmost,
      `${path} menu links must not be covered by page content`
    ).toBe(true);

    const navBox = await nav.boundingBox();
    expect(navBox, `${path} menu should have a layout box`).not.toBeNull();
    expect(navBox.x).toBeGreaterThanOrEqual(0);
    expect(navBox.x + navBox.width).toBeLessThanOrEqual(391);

    await context.close();
  });

  test(`${name} mobile menu closes when tapping outside`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true
    });
    const page = await context.newPage();

    const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
    expect(response?.ok(), `${path} should load`).toBeTruthy();
    await page.waitForFunction(() => Boolean(window.NovelightClient));

    const menu = page.locator('details.mobile-menu');
    const summary = menu.locator('summary');
    const nav = menu.locator(':scope > nav');

    await expect(summary).toBeVisible();
    await summary.tap();
    await expect(menu).toHaveAttribute('open', '');
    await expect(nav).toBeVisible();

    await page.touchscreen.tap(16, 820);

    await expect(menu).not.toHaveAttribute('open', '');
    await expect(nav).toBeHidden();

    await context.close();
  });
}
