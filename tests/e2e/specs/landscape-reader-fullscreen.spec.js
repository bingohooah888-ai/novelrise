import { expect, test } from '@playwright/test';

test('portrait reader expands sideways when rotation is denied', async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(
    [
      '<!doctype html><html lang="ja">',
      '<body class="novelight-page-episode" data-reading-direction="horizontal">',
      '<main><article id="card"><div class="content">',
      '日本語の縦書き小説。'.repeat(500),
      '</div></article></main>',
      '<nav id="nlReadingNav"><div class="nl-reading-nav-main">',
      '<a class="nl-reading-link next" data-landscape-label="第2話に進む"',
      ' href="episode.html?id=episode-3">第2話を読む</a>',
      '</div></nav></body></html>'
    ].join('')
  );
  await page.addStyleTag({ path: '../../novelight-reading-settings.css' });
  await page.evaluate(() => {
    globalThis.document.documentElement.requestFullscreen = () =>
      Promise.reject(new Error('fullscreen denied in test'));
    globalThis.NovelightReadingSettings = {
      load: () => ({ writingMode: 'horizontal' }),
      apply(value) {
        globalThis.document.body.dataset.readingDirection = value.writingMode;
      },
      contentProgress: () => 0.2,
      seekProgress: () => {}
    };
  });
  await page.addScriptTag({ path: '../../novelight-landscape-reader.js' });
  await page.evaluate(() => globalThis.NovelightLandscapeReader.mount());

  const expand = page.locator('#nlLandscapeReaderToggle');
  await expect(expand).toBeVisible();
  await expand.click();
  await expect(page.locator('body')).toHaveAttribute(
    'data-landscape-reader',
    'active'
  );
  await expect(page.locator('body')).toHaveAttribute(
    'data-landscape-reader-rotated',
    'true'
  );
  await expect(expand).toHaveAttribute('aria-pressed', 'true');

  const content = page.locator('#card .content');
  const style = await content.evaluate((element) => {
    const computed = globalThis.getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return {
      transform: computed.transform,
      width: box.width,
      height: box.height
    };
  });
  expect(style.transform).not.toBe('none');
  expect(style.width).toBeCloseTo(390, 0);
  expect(style.height).toBeCloseTo(844, 0);

  await expand.click();
  await expect(page.locator('body')).toHaveAttribute(
    'data-landscape-reader',
    'off'
  );
});
