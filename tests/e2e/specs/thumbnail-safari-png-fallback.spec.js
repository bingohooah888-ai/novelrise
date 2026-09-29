import { expect, test } from '@playwright/test';

test('WebKit preserves Safari PNG canvas fallback through thumbnail persistence', async ({
  browserName,
  page
}) => {
  expect(browserName).toBe('webkit');

  await page.goto('/tests/e2e/fixtures/thumbnail-safari-png-fallback.html');
  const result = await page.evaluate(() =>
    window.runSafariPngFallbackRegression()
  );

  expect(result.requestedCanvasType).toBe('image/webp');
  expect(result.prepare.contentType).toBe('image/png');
  expect(result.prepare.fileSize).toBeGreaterThan(0);
  expect(result.uploaded.blobType).toBe('image/png');
  expect(result.uploaded.contentType).toBe('image/png');
  expect(result.uploaded.path).toMatch(/\.png$/i);
  expect(result.finalize.path).toBe(result.uploaded.path);
  expect(result.renderUrl).toMatch(/\.png$/i);
});
