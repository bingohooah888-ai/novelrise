import { expect, test } from '@playwright/test';

const idA = '12345678-1234-4234-8234-123456789abc';
const idB = 'abcdefab-1234-4234-8234-123456789abc';
const markerA = '[[NOVELIGHT_ILLUSTRATION:' + idA + ']]';
const markerB = '[[NOVELIGHT_ILLUSTRATION:' + idB + ']]';

async function installFixture(page, content) {
  await page.addInitScript((initialContent) => {
    const key = '__safariFixture__';
    const cached = globalThis.sessionStorage.getItem(key);
    globalThis.__safariFixture__ = cached
      ? JSON.parse(cached)
      : {
          content: initialContent,
          updated_at: '2026-10-16T00:00:00Z',
          updates: 0
        };
  }, content);

  await page.route('**/assets/vendor/supabase-js-2.112.3.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: "(() => {\n  const current = () => globalThis.__safariFixture__;\n  const episode = () => ({\n    id: 73006, novel_id: 73007, user_id: 'webkit-owner',\n    title: 'Safari 挿絵検証', episode_number: 3, status: 'published',\n    show_episode_number: true, content: current().content,\n    updated_at: current().updated_at\n  });\n  const novel = {\n    id: 73007, title: 'Safari 検証作品', user_id: 'webkit-owner',\n    content_rating: 'general', content_warnings: [],\n    show_episode_numbers: true, status: 'published'\n  };\n  function table(name) {\n    let op = 'select', update = null;\n    const filters = {};\n    const builder = {\n      select() { return builder; },\n      eq(field, value) { filters[field] = value; return builder; },\n      order() { return builder; },\n      update(payload) { op = 'update'; update = payload; return builder; },\n      single: async () => ({\n        data: name === 'episodes' ? episode() :\n          name === 'novels' ? novel : null, error: null\n      }),\n      maybeSingle: async () => {\n        if (op !== 'update') return { data: null, error: null };\n        if (filters.updated_at !== current().updated_at)\n          return { data: null, error: null };\n        const next = {\n          ...current(), content: update.content,\n          updated_at: '2026-10-16T00:00:01Z',\n          updates: current().updates + 1\n        };\n        globalThis.__safariFixture__ = next;\n        sessionStorage.setItem('__safariFixture__', JSON.stringify(next));\n        return {\n          data: { id: 73006, updated_at: next.updated_at },\n          error: null\n        };\n      },\n      then(resolve, reject) {\n        return Promise.resolve({ data: name === 'episodes' ?\n          [episode()] : [], error: null }).then(resolve, reject);\n      }\n    };\n    return builder;\n  }\n  const session = {\n    user: { id: 'webkit-owner' }, access_token: 'webkit-test'\n  };\n  globalThis.supabase = {\n    createClient: () => ({\n      auth: { getSession: async () => ({ data: { session }, error: null }) },\n      from: table,\n      rpc: async () => ({ data: true, error: null })\n    })\n  };\n})();"
    })
  );
  await page.route('**/api/episode-illustrations', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        aiUsage: false,
        limit: 10,
        assets: [idA, idB].map((id) => ({
          id,
          marker: '[[NOVELIGHT_ILLUSTRATION:' + id + ']]',
          url: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
          width: 1,
          height: 1,
          altText: 'テスト挿絵'
        }))
      })
    })
  );
}

async function verifySaved(page, expected) {
  await expect(page).toHaveURL(/\/episode\.html\?id=73006$/);
  const stored = await page.evaluate(() => globalThis.__safariFixture__);
  expect(stored.updates).toBe(1);
  expect(stored.content).toBe(expected);
  const count = expected.includes(markerB) ? 2 : 1;
  await expect(page.locator('.episode-inline-illustration img')).toHaveCount(
    count
  );
  await expect(page.locator('.episode-inline-illustration-failed')).toHaveCount(0);
}

test('iPhone Safari WebKit saves the first image before redirect', async ({
  page,
  browserName
}) => {
  expect(browserName).toBe('webkit');
  const content = '冒頭\n\n末尾';
  await installFixture(page, content);
  await page.goto('/episode-edit.html?id=73006');
  await expect(page.locator('#content')).toHaveValue(content);
  await page.waitForFunction(
    () => !!globalThis.NovelightEpisodeVisualEditor?.insertMarker
  );

  await page.evaluate((marker) => {
    const source = globalThis.document.getElementById('content');
    source.selectionStart = source.value.length;
    source.selectionEnd = source.value.length;
    globalThis.NovelightEpisodeIllustrations.insertMarker(source, marker);
  }, markerA);
  await expect(page.locator('.nl-visual-illustration')).toHaveCount(1);
  await page.locator('#save').click();
  await verifySaved(page, content + '\n' + markerA);
});

test('iPhone Safari WebKit retains an earlier illustration', async ({
  page,
  browserName
}) => {
  expect(browserName).toBe('webkit');
  const content = '冒頭\n\n' + markerA + '\n\n末尾';
  await installFixture(page, content);
  await page.goto('/episode-edit.html?id=73006');
  await expect(page.locator('.nl-visual-illustration')).toHaveCount(1);

  await page.evaluate((marker) => {
    const editor = globalThis.document.getElementById(
      'novelightVisualBodyEditor'
    );
    const range = globalThis.document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = globalThis.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    globalThis.NovelightEpisodeIllustrations.insertMarker(
      globalThis.document.getElementById('content'),
      marker
    );
  }, markerB);
  await expect(page.locator('.nl-visual-illustration')).toHaveCount(2);
  await page.locator('#save').click();
  await verifySaved(page, content + '\n' + markerB);
});
