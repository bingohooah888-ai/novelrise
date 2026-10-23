import { expect, test } from '../fixtures/diagnostic-fixture.js';

const specialPages = ['/special.html', '/special-detail.html'];

for (const url of specialPages) {
  test(`SPECIAL ${url} uses real assets, canonical header and Mincho typography`, async ({
    page
  }) => {
    const failedResources = [];
    page.on('requestfailed', (request) => {
      if (
        request.url().includes('/assets/') ||
        request.url().endsWith('.css')
      ) {
        failedResources.push(request.url());
      }
    });

    const response = await page.goto(url);
    expect(response?.ok()).toBe(true);
    await expect(page.locator('header.site-header')).toBeVisible();
    await expect(
      page.locator(
        'header.site-header img.logo-image, header.site-header .logo img'
      )
    ).toHaveCount(1);
    await expect(page.locator('main#main-content')).toBeVisible();
    await expect(
      page.locator('header.site-header .site-nav.desktop-nav a')
    ).toHaveCount(4);
    const styles = await page.evaluate(() => {
      const header = globalThis.document.querySelector('header.site-header');
      const img = header.querySelector('img');
      const main = globalThis.document.querySelector('#main-content');
      const heading = globalThis.document.querySelector('h1') ?? main;
      const computed = (element) => globalThis.getComputedStyle(element);
      return {
        logoOk: img.complete && img.naturalWidth > 0,
        documentFont: computed(globalThis.document.documentElement).fontFamily,
        mainFont: computed(main).fontFamily,
        headingFont: computed(heading).fontFamily,
        headerColor: computed(header).backgroundColor,
        htmlWidth: globalThis.document.documentElement.scrollWidth,
        viewportWidth: globalThis.window.innerWidth
      };
    });
    expect(styles.logoOk).toBe(true);
    expect(styles.documentFont).toContain('Yu Mincho');
    expect(styles.mainFont).toContain('Yu Mincho');
    expect(styles.headingFont).toContain('Yu Mincho');
    expect(styles.headerColor).toBe('rgba(250, 249, 246, 0.98)');
    expect(styles.htmlWidth).toBeLessThanOrEqual(styles.viewportWidth + 1);
    expect(failedResources).toEqual([]);
  });
}

test('SPECIAL header matches the existing announcements page at the same viewport', async ({
  page
}) => {
  await page.goto('/announcements.html');
  const reference = await page
    .locator('header.site-header')
    .evaluate((header) => {
      const styles = globalThis.getComputedStyle(header);
      return {
        height: header.getBoundingClientRect().height,
        background: styles.backgroundColor,
        image: header.querySelector('img')?.getAttribute('src')
      };
    });
  await page.goto('/special.html');
  const actual = await page.locator('header.site-header').evaluate((header) => {
    const styles = globalThis.getComputedStyle(header);
    return {
      height: header.getBoundingClientRect().height,
      background: styles.backgroundColor,
      image: header.querySelector('img')?.getAttribute('src')
    };
  });
  expect(actual).toEqual(reference);
});


test('SPECIAL editorial hero remains dark with readable white lettering', async ({
  page
}) => {
  await page.goto('/special.html');
  const styles = await page
    .locator('header.novelight-special-hero')
    .evaluate((hero) => ({
      background: globalThis.getComputedStyle(hero).backgroundImage,
      heading: globalThis.getComputedStyle(hero.querySelector('h1')).color,
      lead: globalThis.getComputedStyle(hero.querySelector('p:last-child')).color
    }));
  expect(styles.background).toContain('linear-gradient');
  expect(styles.heading).toBe('rgb(255, 255, 255)');
  expect(styles.lead).toBe('rgb(224, 227, 233)');
});
