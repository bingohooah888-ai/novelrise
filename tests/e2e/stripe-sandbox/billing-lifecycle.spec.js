import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const fixturePath = process.env.STRIPE_SANDBOX_FIXTURE;

if (!fixturePath) throw new Error('STRIPE_SANDBOX_FIXTURE is required.');

function loadFixture() {
  return JSON.parse(readFileSync(fixturePath, 'utf8'));
}

async function waitForVisibleAction(page, candidates, timeout = 30_000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    for (const candidate of candidates) {
      const locator = page
        .getByRole(candidate.role, { name: candidate.name })
        .last();
      if (await locator.isVisible().catch(() => false)) {
        return locator;
      }
    }

    await page.waitForTimeout(250);
  }

  return null;
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

    const action = await waitForVisibleAction(
      page,
      candidates,
      step === 0 ? 30_000 : 15_000
    );
    if (!action) {
      const bodyText = (await page.locator('body').innerText()).slice(0, 2500);
      throw new Error(
        `No cancellation action became visible in Stripe portal. URL=${page.url()} BODY=${bodyText}`
      );
    }

    await action.click();

    await Promise.race([
      page
        .waitForURL(/example\.com\/novelight-billing-e2e-canceled/, {
          timeout: 10_000
        })
        .catch(() => null),
      page.waitForTimeout(750)
    ]);
  }

  await page.waitForURL(/example\.com\/novelight-billing-e2e-canceled/, {
    timeout: 60_000
  });
});
