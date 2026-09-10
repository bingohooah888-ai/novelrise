import { expect, test } from '@playwright/test';

async function mockCampaignApi(page, state = 'PRE_REGISTRATION') {
  const requests = [];
  await page.route('**/api/beta-author-preregistration', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          campaign: { state, releaseLabel: '2026年9月下旬' }
        })
      });
      return;
    }

    const body = request.postDataJSON();
    requests.push(body);
    if (body.action === 'event') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accepted: true })
      });
      return;
    }
    if (body.action === 'register') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result:
            body.email === 'duplicate@example.com' ? 'duplicate' : 'registered'
        })
      });
      return;
    }
    await route.fulfill({ status: 400, body: '{}' });
  });
  return requests;
}

test('beta author preregistration keeps its standalone theme and submits through the server API', async ({
  page
}) => {
  const requests = await mockCampaignApi(page);
  await page.goto('/beta-authors.html?utm_source=x');

  await expect(page.locator('body')).toHaveAttribute(
    'data-novelight-theme',
    'standalone'
  );
  await expect(page.locator('script[src="novelight-client.js"]')).toHaveCount(
    0
  );
  await expect(page.locator('link[data-novelight-theme]')).toHaveCount(0);
  await expect(page.locator('#preRegistrationState')).toBeVisible();
  await expect(page.locator('#releaseCopy')).toContainText('2026年9月下旬');

  const heroColor = await page.locator('.hero h1').evaluate((element) => {
    const view = element.ownerDocument.defaultView;
    return view ? view.getComputedStyle(element).color : '';
  });
  expect(heroColor).toBe('rgb(255, 255, 255)');

  await page.locator('#penName').fill('E2E作者');
  await page.locator('#email').fill('e2e@example.com');
  await page.locator('#consent').check();
  await page.locator('#submitButton').click();

  await expect(page.locator('#successState')).toBeVisible();
  expect(
    requests.some(
      (body) => body.action === 'event' && body.event_type === 'cta_click'
    )
  ).toBe(true);
  expect(
    requests.some(
      (body) =>
        body.action === 'register' &&
        body.email === 'e2e@example.com' &&
        body.source === 'x'
    )
  ).toBe(true);

  const horizontalOverflow = await page.evaluate(
    () =>
      globalThis.document.documentElement.scrollWidth - globalThis.innerWidth
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
});

test('beta author preregistration does not depend on localStorage', async ({
  page
}) => {
  await page.addInitScript(() => {
    globalThis.Storage.prototype.getItem = () => {
      throw new Error('storage disabled');
    };
    globalThis.Storage.prototype.setItem = () => {
      throw new Error('storage disabled');
    };
  });
  await mockCampaignApi(page);
  await page.goto('/beta-authors.html');
  await expect(page.locator('#preRegistrationState')).toBeVisible();
  await page.locator('#penName').fill('Storageなし作者');
  await page.locator('#email').fill('storage-off@example.com');
  await page.locator('#consent').check();
  await page.locator('#submitButton').click();
  await expect(page.locator('#successState')).toBeVisible();
});

test('duplicate preregistration remains on the form with a clear error', async ({
  page
}) => {
  await mockCampaignApi(page);
  await page.goto('/beta-authors.html');
  await page.locator('#penName').fill('重複作者');
  await page.locator('#email').fill('duplicate@example.com');
  await page.locator('#consent').check();
  await page.locator('#submitButton').click();
  await expect(page.locator('#preRegistrationState')).toBeVisible();
  await expect(page.locator('#formState')).toContainText(
    'すでに先行登録されています'
  );
});

test('BETA_OPEN renders published copy without preregistration copy', async ({
  page
}) => {
  await mockCampaignApi(page, 'BETA_OPEN');
  await page.goto('/beta-authors.html');
  await expect(page.locator('#betaOpenState')).toBeVisible();
  await expect(page.locator('#preRegistrationState')).toBeHidden();
  await expect(page.locator('#releaseCopy')).toHaveText(
    'NOVELIGHT β版を公開しました'
  );
  await expect(page.locator('#guideSection')).toBeHidden();
});

test('CLOSED renders closed state and hides preregistration', async ({
  page
}) => {
  await mockCampaignApi(page, 'CLOSED');
  await page.goto('/beta-authors.html');
  await expect(page.locator('#closedState')).toBeVisible();
  await expect(page.locator('#preRegistrationState')).toBeHidden();
  await expect(page.locator('#releaseCopy')).toHaveText('先行登録受付終了');
});

test('campaign lookup failure fails closed instead of exposing the form', async ({
  page
}) => {
  await page.route('**/api/beta-author-preregistration', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'CAMPAIGN_UNAVAILABLE' })
    });
  });
  await page.goto('/beta-authors.html');
  await expect(page.locator('#unavailableState')).toBeVisible();
  await expect(page.locator('#preRegistrationState')).toBeHidden();
  await expect(page.locator('#heroCta')).toHaveAttribute(
    'aria-disabled',
    'true'
  );
});
