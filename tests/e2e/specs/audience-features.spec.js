import { expect, test } from '../fixtures/diagnostic-fixture.js';

const guides = [
  ['author', '/author-features.html'],
  ['reader', '/reader-features.html']
];

for (const [name, route] of guides) {
  test(`${name} guide uses the light announcement design`, async ({ page }) => {
    await page.goto(route);
    const header = page.locator('header.site-header');
    const card = page.locator('.audience-card').first();

    await expect(header).toBeVisible();
    await expect(card).toBeVisible();

    const colors = await page.evaluate(() => {
      const computed = (selector) =>
        globalThis.getComputedStyle(
          globalThis.document.querySelector(selector)
        );
      return {
        background: computed('body').backgroundColor,
        header: computed('header.site-header').backgroundColor,
        card: computed('.audience-card').backgroundColor,
        text: computed('.audience-card h3').color
      };
    });

    expect(colors.background).toBe('rgb(247, 244, 237)');
    expect(colors.header).toBe('rgba(250, 249, 246, 0.98)');
    expect(colors.card).toBe('rgb(255, 253, 248)');
    expect(colors.text).toBe('rgb(27, 36, 48)');

    const fonts = await page.evaluate(() => {
      const selectors = [
        '.audience-kicker',
        '.audience-lead',
        '.audience-section-head p',
        '.audience-card h3',
        '.audience-card p',
        '.audience-card a',
        '.audience-cta p',
        '.audience-primary'
      ];
      return selectors.map((selector) =>
        globalThis.getComputedStyle(
          globalThis.document.querySelector(selector)
        ).fontSize
      );
    });

    expect(fonts).toEqual([
      '14px',
      page.viewportSize().width <= 640 ? '17px' : '18px',
      '17px',
      '19px',
      '17px',
      '16px',
      '17px',
      '16px'
    ]);
  });

  test(`${name} guide syncs an authenticated visitor's header`, async ({
    page
  }) => {
    await page.route('**/assets/vendor/supabase-js-2.112.3.js', (intercept) =>
      intercept.fulfill({
        contentType: 'application/javascript',
        body: `window.supabase = {
          createClient: () => ({
            auth: {
              getSession: async () => ({
                data: { session: { user: { id: 'example-test-user' } } },
                error: null
              })
            }
          })
        };`
      })
    );

    await page.goto(route);
    await expect(page.locator('.login-action')).toHaveText('創作室');
    await expect(page.locator('.login-action')).toHaveAttribute(
      'href',
      'mypage.html'
    );
    await expect(page.locator('.mobile-login-action')).toHaveText('創作室');
    await expect(page.locator('.signup-action')).toHaveAttribute(
      'data-auth-state',
      'authenticated-hidden'
    );
    await expect(page.locator('.mobile-signup-action')).toHaveAttribute(
      'data-auth-state',
      'authenticated-hidden'
    );
  });
}
