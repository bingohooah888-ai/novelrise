import { expect, test } from '@playwright/test';

const imageId = '12345678-1234-4234-8234-123456789abc';
const marker = '[[NOVELIGHT_ILLUSTRATION:' + imageId + ']]';
const freshImage = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

async function prepare(page, alwaysFail = false) {
  let requests = 0;
  await page.route('**/api/episode-illustrations', (route) => {
    requests += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        assets: [
          {
            id: imageId,
            url:
              alwaysFail || requests === 1
                ? '/__expired_signed_image.webp'
                : freshImage,
            marker,
            width: 1,
            height: 1
          }
        ]
      })
    });
  });
  await page.route('**/__expired_signed_image.webp', (route) =>
    route.fulfill({ status: 403, body: 'expired' })
  );
  await page.goto('/tests/e2e/fixtures/episode-illustration-retry.html');
  await page.evaluate((source) => {
    const root = globalThis.document.getElementById('illustrationTestRoot');
    void globalThis.NovelightEpisodeIllustrations.mountReader({
      root,
      content: source,
      episodeId: 73006
    });
  }, marker);
  return () => requests;
}

test('lazy signed URL expiration refreshes image without losing content', async ({
  page
}) => {
  const requests = await prepare(page);
  await expect(
    page.locator('#illustrationTestRoot .episode-inline-illustration img')
  ).toHaveCount(1);
  await expect(
    page.locator('.episode-inline-illustration img')
  ).toHaveJSProperty('naturalWidth', 1);
  expect(requests()).toBe(2);
  await expect(page.locator('.episode-inline-illustration-failed')).toHaveCount(
    0
  );
});

test('invalid image retries only once then shows a fallback', async ({
  page
}) => {
  const requests = await prepare(page, true);
  await expect(page.locator('.episode-inline-illustration-failed')).toHaveCount(
    1
  );
  expect(requests()).toBe(2);
});
