import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const fixturePath = process.env.STRIPE_SANDBOX_FIXTURE;

if (!fixturePath) throw new Error('STRIPE_SANDBOX_FIXTURE is required.');

function loadFixture() {
  return JSON.parse(readFileSync(fixturePath, 'utf8'));
}

async function clickVisible(page, candidates) {
  for (const candidate of candidates) {
    const locator = page
      .getByRole(candidate.role, { name: candidate.name })
      .last();
    if (await locator.isVisible().catch(() => false)) {
      await locator.click();
      return true;
    }
  }
  return false;
}

test('Stripe Customer Portal schedules cancellation at period end', async ({
  page
}) => {
  const fixture = loadFixture();
  expect(fixture.portalUrl).toMatch(/^https:\/\/billing\.stripe\.com\//);

  await page.goto(fixture.portalUrl, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/billing\.stripe\.com/);

  const candidates = [
    { role: 'button', name: /continue to cancel/i },
    { role: 'button', name: /cancel (subscription|plan)/i },
    { role: 'link', name: /cancel (subscription|plan)/i },
    { role: 'button', name: /confirm cancellation/i },
    { role: 'button', name: /confirm/i }
  ];

  for (let step = 0; step < 5; step += 1) {
    if (/example\.com\/novelight-billing-e2e-canceled/.test(page.url())) {
      break;
    }

    const clicked = await clickVisible(page, candidates);
    if (!clicked) {
      const bodyText = (await page.locator('body').innerText()).slice(0, 2500);
      throw new Error(
        `No cancellation action was visible in Stripe portal. URL=${page.url()} BODY=${bodyText}`
      );
    }

    await page.waitForLoadState('domcontentloaded').catch(() => {});
  }

  await page.waitForURL(/example\.com\/novelight-billing-e2e-canceled/, {
    timeout: 60_000
  });
});
