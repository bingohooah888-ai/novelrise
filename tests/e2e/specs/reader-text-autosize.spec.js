import { expect, test } from '@playwright/test';

const imageId = '12345678-1234-4234-8234-123456789abc';
const marker = '[[NOVELIGHT_ILLUSTRATION:' + imageId + ']]';
const image = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

async function setupReader(page, writingMode) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tests/e2e/fixtures/episode-illustration-retry.html');
  await page.evaluate(() => {
    document.body.className = 'novelight-page-episode';
    document.body.innerHTML =
      '<main><div id="readingSettingsMount"></div><article id="card"><div class="content"></div></article></main>';
    globalThis.NovelightProse = { renderInto() {} };
    globalThis.NovelightReaderTts = {};
  });
  await page.addStyleTag({ path: '../../novelight-reading-settings.css' });
  await page.addStyleTag({ path: '../../novelight-episode-illustrations.css' });
  await page.addScriptTag({ path: '../../novelight-reading-settings.js' });
  await page.evaluate((mode) => {
    localStorage.setItem(
      'novelight:reading-settings:v1',
      JSON.stringify({
        fontSize: 'small',
        lineHeight: 'standard',
        theme: 'light',
        width: 'standard',
        writingMode: mode
      })
    );
    globalThis.NovelightReadingSettings.mount();
  }, writingMode);
}

async function readerStyle(page) {
  return page.locator('#card .content').evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      size: style.fontSize,
      direction: style.writingMode
    };
  });
}

test('iPhone-like vertical reader keeps chosen size after illustration re-render', async ({
  page
}) => {
  let releaseResponse;
  const delayedResponse = new Promise((resolve) => {
    releaseResponse = resolve;
  });
  await page.route('**/api/episode-illustrations', async (route) => {
    await delayedResponse;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        aiUsage: false,
        assets: [{ id: imageId, url: image, width: 1, height: 1 }]
      })
    });
  });

  await setupReader(page, 'vertical');
  const content = [
    'これは縦書き表示の文字サイズ検証です。'.repeat(60),
    marker,
    '挿絵の後にも本文が続きます。'.repeat(60)
  ].join('\n');
  await page.evaluate((text) => {
    void globalThis.NovelightEpisodeIllustrations.mountReader({
      root: document.querySelector('#card .content'),
      episodeId: 73006,
      content: text
    });
  }, content);
  await expect(
    page.locator('#card .content .episode-inline-illustration-failed')
  ).toHaveCount(1);
  expect(await readerStyle(page)).toEqual({
    size: '15px',
    direction: 'vertical-rl'
  });

  releaseResponse();
  await expect(
    page.locator('#card .content .episode-inline-illustration img')
  ).toHaveCount(1);
  expect(await readerStyle(page)).toEqual({
    size: '15px',
    direction: 'vertical-rl'
  });

  await page.locator('.reading-settings-summary').click();
  await page.getByLabel('文字サイズ').selectOption('xlarge');
  expect((await readerStyle(page)).size).toBe('21px');
  await page.getByLabel('文字サイズ').selectOption('small');
  expect((await readerStyle(page)).size).toBe('15px');
});

test('horizontal reader remains adjustable without vertical-only autosizing override', async ({
  page
}) => {
  await setupReader(page, 'horizontal');
  const before = await readerStyle(page);
  expect(before).toMatchObject({ size: '15px', direction: 'horizontal-tb' });
  await page.locator('.reading-settings-summary').click();
  await page.getByLabel('文字サイズ').selectOption('xlarge');
  expect((await readerStyle(page)).size).toBe('21px');
  await page.getByLabel('文字サイズ').selectOption('small');
  expect((await readerStyle(page)).size).toBe('15px');
});
