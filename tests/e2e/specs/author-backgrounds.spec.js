import { expect, test } from '@playwright/test';

test('account background choice is applied before page scripts run', async ({
  page
}) => {
  await page.route('**/assets/vendor/supabase-js-2.112.3.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.supabase={createClient:()=>({auth:{getUser:async()=>({data:{user:{email:'author@example.com'}},error:null})}})};`
    })
  );
  await page.addInitScript(() => {
    globalThis.localStorage.setItem('novelight_author_background', 'simple');
  });
  await page.goto('/account-settings.html', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('html')).toHaveAttribute(
    'data-author-background',
    'simple'
  );
  await expect(
    page.locator('input[name="authorBackground"][value="simple"]')
  ).toBeChecked();
  const simpleBackground = await page.locator('body').evaluate((body) => {
    const style = globalThis.getComputedStyle(body);
    return { color: style.backgroundColor, image: style.backgroundImage };
  });
  expect(simpleBackground).toEqual({ color: 'rgb(15, 16, 32)', image: 'none' });

  await page
    .locator('input[name="authorBackground"][value="decorative"]')
    .check();
  await expect(page.locator('html')).toHaveAttribute(
    'data-author-background',
    'decorative'
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        globalThis.localStorage.getItem('novelight_author_background')
      )
    )
    .toBe('decorative');
  await expect(page.locator('body')).not.toHaveCSS('background-image', 'none');
});
