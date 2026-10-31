import { expect, test } from '../fixtures/diagnostic-fixture.js';

// Browser tests are intentionally local-only: the real author-draft runtime runs
// in Chromium against a static page shell, without Auth or Supabase mutations.
for (const [surface, query, draftKey] of [
  ['post', 'novel_id=123', 'new:123'],
  ['edit', 'id=456', 'edit:456']
]) {
  // Keep the embedded static HTML fixture's exact layout intact.
  // prettier-ignore
  test(`episode-${surface} preview, live count and recovery work in Chromium`, async ({
    page,
    request
  }) => {
    const response = await request.get(`/episode-${surface}.html`);
    expect(response.ok()).toBeTruthy();
    const original = await response.text();
    const css = original.match(/<style>([\s\S]*?)<\/style>/u)?.[1];
    expect(css).toBeTruthy();

    const submitId = surface === 'post' ? 'publish' : 'save';
    const fixture = `<!doctype html>
      <html lang="ja">
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>${css}</style>
        </head>
        <body class="novelight-theme novelight-page-episode-${surface}">
          <main>
            <form id="form">
              <div class="editor-toolbar">
                <div class="editor-tools">
                  <button type="submit" id="${submitId}">保存</button>
                </div>
              </div>
              <section class="writing-surface">
                <input id="episodeNumber" type="number" value="2" readonly>
                <input id="title" value="テスト話">
                <div class="body-field">
                  <label class="body-label" for="content">本文</label>
                  <textarea id="content" maxlength="100000"></textarea>
                </div>
              </section>
              <div class="buttons" hidden></div>
            </form>
          </main>
          <script src="/novelight-author-draft.js"></script>
        </body>
      </html>`;

    await page.route(`**/episode-${surface}.html*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: fixture
      })
    );
    await page.goto(`/episode-${surface}.html?${query}`);
    await page.locator('#form').evaluate((form) => {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        globalThis.__testSubmitted = true;
      });
    });

    const counter = page.locator('#nlAuthorCharacterCount');
    const previewButton = page.locator('#nlAuthorPreviewButton');
    await expect(counter).toHaveText('0 / 100,000文字');
    await expect(previewButton).toBeVisible();

    const content = '玲《アキラ》と《《大事》》\n次の行';
    await page.locator('#content').fill(content);
    await expect(counter).toHaveText(
      `${content.length.toLocaleString('ja-JP')} / 100,000文字`
    );

    await page.waitForFunction(() => Boolean(globalThis.NovelightProse));
    await previewButton.click();
    await expect(page.locator('.nl-preview-modal')).toBeVisible();
    await expect(page.locator('.nl-preview-content ruby rt')).toHaveText(
      'アキラ'
    );
    await expect(
      page.locator('.nl-preview-content .nl-prose-emphasis')
    ).toHaveText('大事');
    await expect(page.locator('.nl-preview-content')).toContainText('次の行');
    expect(await page.evaluate(() => Boolean(globalThis.__testSubmitted))).toBe(
      false
    );
    await page.keyboard.press('Escape');
    await expect(page.locator('.nl-preview-modal')).toHaveCount(0);

    const localKey = `novelight:episode-draft:v1:${draftKey}`;
    await expect.poll(async () => {
      const local = await page.evaluate(
        (key) => globalThis.localStorage.getItem(key),
        localKey
      );
      return local ? JSON.parse(local).content : null;
    }).toBe(content);

    await page.reload();
    await expect(page.locator('#nlDraftRestore')).toBeVisible();
    await page.locator('#nlDraftRestore').getByText('復元する').click();
    await expect(page.locator('#content')).toHaveValue(content);
    await expect(counter).toHaveText(
      `${content.length.toLocaleString('ja-JP')} / 100,000文字`
    );
    await expect(page.locator('#nlAuthorPreviewButton')).toBeVisible();

    const overflow = await page.locator('html').evaluate((html) => ({
      width: html.clientWidth,
      scroll: html.scrollWidth
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.width + 1);
  });
}
