import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '../fixtures/diagnostic-fixture.js';

const output = resolve('artifacts/novelight-special');
const pages = [
  ['list', '/special.html'],
  ['detail', '/special-detail.html']
];

async function headerMetrics(page) {
  return page.evaluate(() => {
    const selectors = [
      'header.site-header',
      'header.site-header .public-header-inner',
      'header.site-header .logo img',
      'header.site-header .desktop-nav',
      'header.site-header .header-actions',
      'header.site-header .header-search',
      'header.site-header .login-action',
      'header.site-header .signup-action',
      'header.site-header .mobile-menu',
      'header.site-header .mobile-menu summary'
    ];
    return Object.fromEntries(
      selectors.map((selector) => {
        const node = globalThis.document.querySelector(selector);
        if (!node) return [selector, null];
        const bounds = node.getBoundingClientRect();
        const css = globalThis.getComputedStyle(node);
        const round = (value) => Math.round(value * 100) / 100;
        return [
          selector,
          {
            x: round(bounds.x),
            y: round(bounds.y),
            width: round(bounds.width),
            height: round(bounds.height),
            display: css.display,
            background: css.backgroundColor,
            gap: css.gap,
            font: css.fontFamily
          }
        ];
      })
    );
  });
}

async function renderedFonts(page) {
  const devtools = await page.context().newCDPSession(page);
  try {
    await devtools.send('DOM.enable');
    await devtools.send('CSS.enable');
    const { root } = await devtools.send('DOM.getDocument');
    const { nodeId } = await devtools.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: 'main h1'
    });
    expect(nodeId).toBeGreaterThan(0);
    const { fonts } = await devtools.send('CSS.getPlatformFontsForNode', {
      nodeId
    });
    return fonts
      .filter((font) => font.glyphCount > 0)
      .map(({ familyName, glyphCount, isCustomFont }) => ({
        familyName,
        glyphCount,
        isCustomFont
      }));
  } finally {
    await devtools.detach();
  }
}

async function offlineHtml(page) {
  return page.evaluate(async () => {
    const original = globalThis.document;
    const cloned = original.documentElement.cloneNode(true);
    const cache = new Map();

    const inlineAsset = async (url) => {
      if (cache.has(url)) return cache.get(url);
      const target = new globalThis.URL(url, globalThis.location.href);
      if (target.origin !== globalThis.location.origin) return 'data:,';
      const response = await globalThis.fetch(target.href);
      if (!response.ok) return 'data:,';
      const blob = await response.blob();
      const data = await new Promise((done, fail) => {
        const reader = new globalThis.FileReader();
        reader.onload = () => done(reader.result);
        reader.onerror = () => fail(reader.error);
        reader.readAsDataURL(blob);
      });
      cache.set(url, data);
      return data;
    };

    const inlineCss = async (url, chain = new Set()) => {
      if (chain.has(url)) throw new Error('Circular CSS import: ' + url);
      chain.add(url);
      const response = await globalThis.fetch(url);
      if (!response.ok) throw new Error('Missing stylesheet: ' + url);
      let css = await response.text();
      for (const match of [
        ...css.matchAll(/@import\s+url\(\s*["']?([^"'()]+)["']?\s*\)\s*;/gu)
      ]) {
        const next = new globalThis.URL(match[1], url).href;
        css = css.replace(match[0], await inlineCss(next, new Set(chain)));
      }
      for (const match of [
        ...css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gu)
      ]) {
        const raw = match[2].trim();
        if (raw.startsWith('data:') || raw.startsWith('#')) continue;
        const asset = new globalThis.URL(raw, url).href;
        css = css.replace(match[0], 'url("' + (await inlineAsset(asset)) + '")');
      }
      return css;
    };

    const originalStyles = [...original.querySelectorAll('link[rel="stylesheet"]')];
    const copiedStyles = [...cloned.querySelectorAll('link[rel="stylesheet"]')];
    for (let i = 0; i < originalStyles.length; i += 1) {
      const style = original.createElement('style');
      style.textContent = await inlineCss(originalStyles[i].href);
      copiedStyles[i].replaceWith(style);
    }

    const originalImages = [...original.querySelectorAll('img')];
    const copiedImages = [...cloned.querySelectorAll('img')];
    for (let i = 0; i < originalImages.length; i += 1) {
      copiedImages[i].src = await inlineAsset(originalImages[i].src);
      copiedImages[i].removeAttribute('srcset');
    }

    cloned.querySelectorAll('script, link').forEach((node) => node.remove());
    const csp = original.createElement('meta');
    csp.setAttribute('http-equiv', 'Content-Security-Policy');
    csp.setAttribute(
      'content',
      "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"
    );
    cloned.querySelector('head').prepend(csp);
    return '<!DOCTYPE html>\n' + cloned.outerHTML;
  });
}

for (const [label, route] of pages) {
  test('SPECIAL ' + label + ' screenshot and offline review', async ({
    page
  }, testInfo) => {
    await mkdir(output, { recursive: true });
    await page.goto('/announcements.html');
    const reference = await headerMetrics(page);
    const response = await page.goto(route);
    expect(response?.ok()).toBe(true);
    await expect(page.locator('main h1')).toBeVisible();
    await page.evaluate(() => globalThis.document.fonts.ready);

    const prefix = testInfo.project.name + '-' + label;
    await page.screenshot({
      path: resolve(output, prefix + '.png'),
      fullPage: true
    });

    const actual = await headerMetrics(page);
    const fonts = await renderedFonts(page);
    await writeFile(
      resolve(output, prefix + '-diagnostics.json'),
      JSON.stringify({ route, reference, actual, fonts }, null, 2)
    );
    expect(actual).toEqual(reference);
    expect(
      fonts.some((font) => /mincho|serif|明朝|ming|song/iu.test(font.familyName)),
      'Japanese headings must actually render in a Mincho/serif font'
    ).toBe(true);

    const html = await offlineHtml(page);
    const destination = resolve(output, prefix + '-offline.html');
    await writeFile(destination, html, 'utf8');
    expect(html).not.toMatch(/<script\b/iu);
    expect(html).not.toMatch(/<link\b/iu);
    expect(html).not.toMatch(/@import\s/iu);

    const offline = await page.context().newPage();
    try {
      const external = [];
      offline.on('request', (request) => {
        if (/^https?:/iu.test(request.url())) external.push(request.url());
      });
      await offline.goto('file://' + destination);
      await expect(offline.locator('main h1')).toBeVisible();
      const width = await offline.locator('header.site-header .logo img')
        .evaluate((image) => image.naturalWidth);
      expect(width).toBeGreaterThan(0);
      expect(external).toEqual([]);
    } finally {
      await offline.close();
    }
  });
}
