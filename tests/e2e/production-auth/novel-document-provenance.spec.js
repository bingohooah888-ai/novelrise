import { devices, expect, test } from '@playwright/test';

function contextOptions(baseURL) {
  const descriptor = { ...devices['Desktop Chrome'] };
  delete descriptor.defaultBrowserType;
  return {
    ...descriptor,
    baseURL,
    serviceWorkers: 'block'
  };
}

test(
  'Production novel document serves the current LIGHT SEED shell to a manual Chrome context',
  async ({ browser, baseURL }) => {
    const context = await browser.newContext(contextOptions(baseURL));
    await context.route('**/novel.html*', async (route) => {
      const request = route.request();
      if (request.resourceType() !== 'document') {
        await route.continue();
        return;
      }
      await route.continue({
        headers: {
          ...request.headers(),
          'cache-control': 'no-cache',
          pragma: 'no-cache'
        }
      });
    });

    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

    try {
      const response = await page.goto('/novel.html?id=0', {
        waitUntil: 'domcontentloaded'
      });
      expect(response).not.toBeNull();

      const responseBody = await response.text();
      const finalUrl = new URL(page.url());
      const seedCount = await page
        .locator('.seed-choice[data-seed-type="BRONZE"]')
        .count();
      const diagnostic = {
        status: response.status(),
        responseUrl: response.url(),
        finalUrl: page.url(),
        xVercelCache: await response.headerValue('x-vercel-cache'),
        age: await response.headerValue('age'),
        cacheControl: await response.headerValue('cache-control'),
        responseHasBronze: responseBody.includes('data-seed-type="BRONZE"'),
        domHasBronze: seedCount === 1
      };

      expect(
        diagnostic,
        `Production novel document provenance mismatch: ${JSON.stringify(diagnostic)}`
      ).toMatchObject({
        status: 200,
        responseHasBronze: true,
        domHasBronze: true
      });
      expect(finalUrl.pathname).toBe('/novel.html');
      expect(seedCount).toBe(1);
    } finally {
      await context.close();
    }
  }
);
