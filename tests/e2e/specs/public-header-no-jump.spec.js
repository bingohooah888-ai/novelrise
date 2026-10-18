import { expect, test } from '@playwright/test';

const pages = [
  '/',
  '/recommended.html',
  '/light-seed.html',
  '/search.html',
  '/ranking.html',
  '/pricing.html',
  '/announcements.html',
  '/special-light.html'
];

async function measureHeader(page) {
  return page.evaluate(() => {
    const selectors = {
      outer: 'header.site-header',
      inner: 'header.site-header .public-header-inner',
      logo: 'header.site-header .logo img',
      nav: 'header.site-header .desktop-nav',
      actions: 'header.site-header .header-actions'
    };
    return Object.fromEntries(
      Object.entries(selectors).map(([key, selector]) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error('Missing shared header: ' + selector);
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return [
          key,
          {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            display: style.display,
            position: style.position
          }
        ];
      })
    );
  });
}

function expectGeometryUnchanged(before, after, label) {
  for (const key of Object.keys(before)) {
    for (const dimension of ['x', 'y', 'width', 'height']) {
      expect(
        Math.abs(before[key][dimension] - after[key][dimension]),
        label + ' ' + key + '.' + dimension
      ).toBeLessThanOrEqual(1);
    }
    expect(after[key].display, label + ' ' + key + '.display').toBe(
      before[key].display
    );
  }
}

for (const path of pages) {
  test(
    'header geometry is stable before and after JS: ' + path,
    async ({ page }) => {
    let unblockClient;
    await page.route('**/novelight-client.js', async (route) => {
      await new Promise((resolve) => {
        unblockClient = resolve;
      });
      await route.continue();
    });

    await page.goto(path, { waitUntil: 'commit' });
    try {
      const header = page.locator('header.site-header .public-header-inner');
      await expect(header).toBeVisible();
      await expect.poll(() => Boolean(unblockClient)).toBe(true);
      const before = await measureHeader(page);
      expect(before.inner.height).toBeGreaterThan(70);
      expect(before.logo.height).toBeGreaterThan(30);

      unblockClient();
      await page.waitForLoadState('load');
      await page.waitForTimeout(200);
      const after = await measureHeader(page);
      expectGeometryUnchanged(before, after, path);
    } finally {
      unblockClient?.();
    }
    }
  );
}

for (const path of ['/', '/recommended.html', '/search.html']) {
  test(
    'login-to-creator label swap does not move public header: ' + path,
    async ({ page }) => {
    await page.goto(path);
    const before = await measureHeader(page);
    await page.evaluate(async () => {
      await window.NovelightClient.syncAuthHeader({
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: 'synthetic-test-user' } } },
            error: null
          })
        }
      });
    });
    await expect(
      page.locator('header.site-header .login-action')
    ).toHaveText('創作室');
    const authenticated = await measureHeader(page);
    expectGeometryUnchanged(before, authenticated, path + ':authenticated');

    await page.evaluate(async () => {
      await window.NovelightClient.syncAuthHeader({
        auth: {
          getSession: async () => ({
            data: { session: null },
            error: null
          })
        }
      });
    });
    await expect(
      page.locator('header.site-header .login-action')
    ).toHaveText('ログイン');
    const anonymous = await measureHeader(page);
    expectGeometryUnchanged(before, anonymous, path + ':anonymous');
    }
  );
}
