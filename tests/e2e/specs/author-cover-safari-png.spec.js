import { expect, test } from '@playwright/test';

test('WebKit author cover persists actual PNG returned for a WebP canvas request', async ({
  page,
  browserName
}) => {
  expect(browserName).toBe('webkit');
  await page.goto('/tests/e2e/fixtures/author-cover-safari-png.html');
  const result = await page.evaluate(() =>
    globalThis.runAuthorCoverSafariPngRegression(true)
  );
  expect(result.requested).toBe('image/webp');
  expect(result.uploaded?.blobType).toBe('image/png');
  expect(result.uploaded?.contentType).toBe('image/png');
  expect(result.uploaded?.path).toMatch(/\.png$/u);
  expect(result.recorded).toEqual(['storage', 'db']);
  expect(result.currentPath).toBe(result.uploaded.path);
  expect(result.previewHidden).toBe(false);
  expect(result.xPreviewHidden).toBe(false);
});

test('WebKit draft cover does not show a public-only X image link', async ({
  page,
  browserName
}) => {
  expect(browserName).toBe('webkit');
  await page.goto('/tests/e2e/fixtures/author-cover-safari-png.html');
  const result = await page.evaluate(() =>
    globalThis.runAuthorCoverSafariPngRegression(false)
  );
  expect(result.uploaded?.contentType).toBe('image/png');
  expect(result.previewHidden).toBe(false);
  expect(result.xPreviewHidden).toBe(true);
});
