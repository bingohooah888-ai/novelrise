import { expect, test } from '@playwright/test';

const publicPages = [
  ['home', '/index.html'],
  ['pricing', '/pricing.html'],
  ['login', '/login.html'],
  ['signup', '/signup.html']
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

test('login form exposes the required controls', async ({ page }) => {
  await page.goto('/login.html', {
    waitUntil: 'domcontentloaded'
  });

  await expect(page.locator('#email')).toBeVisible();
  await expect(page.locator('#password')).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeVisible();
});
