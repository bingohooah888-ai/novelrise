import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const lines = Array.from({ length: 120 }, (_, index) =>
  `第${index + 1}段落。改行と削除を繰り返しても本文が動かないことを確認します。`
).join('\n');

for (const surface of ['post', 'edit']) {
  test(`episode-${surface} keeps caret editing and toolbar geometry stable`, async ({
    page
  }) => {
    const html = readFileSync(
      new URL(`../../../episode-${surface}.html`, import.meta.url),
      'utf8'
    );
    const inlineStyle = html.match(/<style>([\s\S]*?)<\/style>/u)?.[1];
    expect(inlineStyle).toBeTruthy();

    await page.setContent(`
      <!doctype html>
      <html lang="ja">
      <head>
        <meta name="viewport" content="width=device-width,initial-scale=1.0">
        <style>${inlineStyle}</style>
      </head>
      <body class="novelight-theme novelight-page-episode-${surface}">
        <main>
          <form>
            <div class="editor-toolbar" id="toolbar">
              <span class="save-state">保存済み</span>
              <div class="editor-tools"><button type="button">装飾</button></div>
            </div>
            <section class="writing-surface">
              <div class="body-field"><textarea id="content"></textarea></div>
            </section>
          </form>
          <div style="height:1200px"></div>
        </main>
      </body>
      </html>
    `);

    await page.evaluate(() => window.scrollTo(0, 310));
    const toolbarTop = await page.locator('#toolbar').evaluate(
      (element) => element.getBoundingClientRect().top
    );
    expect(toolbarTop).toBeLessThan(0);

    const textarea = page.locator('#content');
    await textarea.fill(lines);
    await textarea.press('ControlOrMeta+End');

    const before = await textarea.evaluate((element) => ({
      value: element.value,
      height: element.getBoundingClientRect().height,
      pageY: window.scrollY,
      scrollTop: element.scrollTop,
      selectionStart: element.selectionStart
    }));
    expect(before.scrollTop).toBeGreaterThan(0);

    await textarea.press('Enter');
    await textarea.press('Backspace');

    const after = await textarea.evaluate((element) => ({
      value: element.value,
      height: element.getBoundingClientRect().height,
      pageY: window.scrollY,
      scrollTop: element.scrollTop,
      selectionStart: element.selectionStart
    }));
    expect(after.value).toBe(before.value);
    expect(after.height).toBe(before.height);
    expect(after.selectionStart).toBe(before.selectionStart);
    expect(after.scrollTop).toBeGreaterThan(0);
    expect(Math.abs(after.pageY - before.pageY)).toBeLessThan(3);
  });
}
