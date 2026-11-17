import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const imageId = '12345678-1234-4234-8234-123456789abc';
const marker = '[[NOVELIGHT_ILLUSTRATION:' + imageId + ']]';
const image = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
const largeIllustration =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1300">' +
      '<rect width="900" height="1300" fill="#cccccc"/></svg>'
  );

async function setupReader(page, writingMode, cssOverride = null) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tests/e2e/fixtures/episode-illustration-retry.html');
  await page.evaluate(() => {
    const viewport = globalThis.document.createElement('meta');
    viewport.name = 'viewport';
    viewport.content = 'width=device-width,initial-scale=1.0';
    globalThis.document.head.append(viewport);
    globalThis.document.body.className = 'novelight-page-episode';
    globalThis.document.body.innerHTML =
      '<main><div id="readingSettingsMount"></div><article id="card"><div class="content"></div></article></main>';
    globalThis.NovelightProse = { renderInto() {} };
    globalThis.NovelightReaderTts = {};
  });
  if (cssOverride === null) {
    await page.addStyleTag({ path: '../../novelight-reading-settings.css' });
  } else {
    await page.addStyleTag({ content: cssOverride });
  }
  await page.addStyleTag({ path: '../../novelight-episode-illustrations.css' });
  await page.addScriptTag({ path: '../../novelight-reading-settings.js' });
  await page.evaluate((mode) => {
    globalThis.localStorage.setItem(
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
    const style = globalThis.getComputedStyle(element);
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
      root: globalThis.document.querySelector('#card .content'),
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

async function glyphMetrics(page) {
  return page.locator('#card .content .nl-episode-prose-text').first().evaluate((holder) => {
    const root = holder.closest('.content');
    const node = holder.firstChild;
    if (!node || node.nodeType !== 3 || node.textContent.length < 5) {
      throw new Error('A/B prose text fixture is incomplete');
    }
    const glyphHeights = [];
    const glyphWidths = [];
    for (let index = 0; index < 5; index += 1) {
      const range = globalThis.document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const rect = range.getBoundingClientRect();
      glyphHeights.push(Number(rect.height.toFixed(2)));
      glyphWidths.push(Number(rect.width.toFixed(2)));
      range.detach();
    }
    const textBox = holder.getBoundingClientRect();
    const style = globalThis.getComputedStyle(root);
    return {
      fontSize: style.fontSize,
      writingMode: style.writingMode,
      textSizeAdjust: style.getPropertyValue('-webkit-text-size-adjust'),
      glyphHeight: glyphHeights[0],
      glyphWidth: glyphWidths[0],
      glyphHeights,
      textBoxWidth: Number(textBox.width.toFixed(2)),
      textBoxHeight: Number(textBox.height.toFixed(2))
    };
  });
}

async function runIllustrationABCase(page, css, name) {
  await page.unroute('**/api/episode-illustrations');
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let mockedCalls = 0;
  await page.route('**/api/episode-illustrations', async (route) => {
    mockedCalls += 1;
    await gate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        aiUsage: false,
        assets: [
          { id: imageId, url: largeIllustration, width: 900, height: 1300 }
        ]
      })
    });
  });
  await setupReader(page, 'vertical', css);
  const prose = [
    'これは縦書きで挿絵が読み込まれる前後の表示検証です。'.repeat(60),
    marker,
    '挿絵が表示された後も文章が続きます。'.repeat(60)
  ].join('\n');
  await page.evaluate((content) => {
    void globalThis.NovelightEpisodeIllustrations.mountReader({
      root: globalThis.document.querySelector('#card .content'),
      episodeId: 73006,
      content
    });
  }, prose);
  await expect(
    page.locator('#card .content .episode-inline-illustration-failed')
  ).toHaveCount(1);
  const before = await glyphMetrics(page);
  await test.info().attach(name + '-before.png', {
    body: await page.screenshot({ animations: 'disabled' }),
    contentType: 'image/png'
  });
  await page.waitForTimeout(1250);
  release();
  await expect(
    page.locator('#card .content .episode-inline-illustration img')
  ).toHaveCount(1);
  const after = await glyphMetrics(page);
  await test.info().attach(name + '-after.png', {
    body: await page.screenshot({ animations: 'disabled' }),
    contentType: 'image/png'
  });
  await page.locator('.reading-settings-summary').click();
  await page.getByLabel('文字サイズ').selectOption('xlarge');
  const large = await glyphMetrics(page);
  await page.getByLabel('文字サイズ').selectOption('small');
  const restored = await glyphMetrics(page);
  expect(mockedCalls).toBe(1);
  return { before, after, large, restored };
}

test('offline WebKit A/B: rendered glyphs before and after illustration reflow', async ({
  page
}) => {
  const baseURL = new globalThis.URL(test.info().project.use.baseURL);
  expect(baseURL.protocol).toBe('http:');
  expect(baseURL.hostname).toBe('127.0.0.1');
  const blockedExternal = [];
  await page.context().route('**/*', async (route) => {
    if (new globalThis.URL(route.request().url()).origin === baseURL.origin) {
      await route.continue();
      return;
    }
    blockedExternal.push('blocked');
    await route.abort('blockedbyclient');
  });

  const fixedCSS = await readFile(
    new globalThis.URL('../../../novelight-reading-settings.css', import.meta.url),
    'utf8'
  );
  const fixLines = [
    /^[ \t]*\/\* Keep iOS reader text at the user-selected size across illustration redraws\. \*\/\r?\n/gm,
    /^[ \t]*-webkit-text-size-adjust: none;\r?\n/gm,
    /^[ \t]*text-size-adjust: none;\r?\n/gm
  ];
  for (const rule of fixLines) {
    expect((fixedCSS.match(rule) || []).length).toBe(3);
  }
  let baselineCSS = fixedCSS;
  for (const rule of fixLines) baselineCSS = baselineCSS.replace(rule, '');
  expect(baselineCSS).not.toBe(fixedCSS);

  const beforeFix = await runIllustrationABCase(
    page,
    baselineCSS,
    'original-css'
  );
  const afterFix = await runIllustrationABCase(
    page,
    fixedCSS,
    'fixed-css'
  );

  expect(blockedExternal).toHaveLength(0);
  for (const sample of [beforeFix, afterFix]) {
    expect(sample.before.fontSize).toBe('15px');
    expect(sample.after.fontSize).toBe('15px');
    expect(sample.large.fontSize).toBe('21px');
    expect(sample.restored.fontSize).toBe('15px');
    expect(sample.before.writingMode).toBe('vertical-rl');
    expect(sample.after.writingMode).toBe('vertical-rl');
    expect(sample.before.glyphHeight).toBeGreaterThan(0);
    expect(sample.after.glyphHeight).toBeGreaterThan(0);
  }
  expect(afterFix.after.glyphHeight).toBeCloseTo(
    afterFix.before.glyphHeight,
    0
  );
  expect(afterFix.restored.glyphHeight).toBeCloseTo(
    afterFix.after.glyphHeight,
    0
  );
  expect(afterFix.large.glyphHeight).toBeGreaterThan(
    afterFix.after.glyphHeight * 1.15
  );

  const inflationRatio =
    beforeFix.after.glyphHeight / beforeFix.before.glyphHeight;
  const baselineReproduced = inflationRatio > 1.2;
  // A passing fixed-size check is NOT a causal proof if the baseline is stable.
  console.log(
    'OFFLINE_WEBKIT_AB',
    JSON.stringify({
      baselineReproduced,
      inflationRatio: Number(inflationRatio.toFixed(3)),
      baseline: beforeFix,
      corrected: afterFix,
      externalRequests: blockedExternal.length,
      causalProof: baselineReproduced ? 'candidate' : 'not-established'
    })
  );
});
