import { expect, test } from '../fixtures/diagnostic-fixture.js';

test('skip link is the first keyboard stop and moves navigation to main content', async ({
  page
}) => {
  await page.goto('/terms.html', { waitUntil: 'domcontentloaded' });

  await page.keyboard.press('Tab');
  const skipLink = page.locator('.skip-link');
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toHaveAttribute('href', '#main-content');

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main-content$/);
  await expect(page.locator('#main-content')).toBeFocused();
});

test('shared focus-visible style is available on keyboard controls', async ({
  page
}) => {
  await page.goto('/login.html', { waitUntil: 'domcontentloaded' });
  const email = page.locator('#email');
  await email.focus();

  const outlineStyle = await email.evaluate(
    (node) => globalThis.getComputedStyle(node).outlineStyle
  );
  const outlineWidth = await email.evaluate(
    (node) => globalThis.getComputedStyle(node).outlineWidth
  );

  expect(outlineStyle).not.toBe('none');
  expect(Number.parseFloat(outlineWidth)).toBeGreaterThanOrEqual(3);
});
