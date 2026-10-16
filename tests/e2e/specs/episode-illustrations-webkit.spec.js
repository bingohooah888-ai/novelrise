import { expect, test } from '@playwright/test';

const idA = '12345678-1234-4234-8234-123456789abc';
const idB = 'abcdefab-1234-4234-8234-123456789abc';
const markerA = '[[NOVELIGHT_ILLUSTRATION:' + idA + ']]';
const markerB = '[[NOVELIGHT_ILLUSTRATION:' + idB + ']]';

// The exact serialized function body is used as a browser-injected fixture.
// prettier-ignore
function provideMockSupabase() {
  const current = () => globalThis.__safariFixture__;
  const episode = () => ({
    id: 73006, novel_id: 73007, user_id: 'webkit-owner',
    title: 'Safari 挿絵検証', episode_number: 3, status: 'published',
    show_episode_number: true, content: current().content,
    updated_at: current().updated_at
  });
  const novel = {
    id: 73007, title: 'Safari 検証作品', user_id: 'webkit-owner',
    content_rating: 'general', content_warnings: [],
    show_episode_numbers: true, status: 'published'
  };
  function table(name) {
    let op = 'select', update = null;
    const filters = {};
    const builder = {
      select() { return builder; },
      eq(field, value) { filters[field] = value; return builder; },
      order() { return builder; },
      update(payload) { op = 'update'; update = payload; return builder; },
      single: async () => ({
        data: name === 'episodes' ? episode() :
          name === 'novels' ? novel : null, error: null
      }),
      maybeSingle: async () => {
        if (op !== 'update') return { data: null, error: null };
        if (filters.updated_at !== current().updated_at)
          return { data: null, error: null };
        const next = {
          ...current(), content: update.content,
          updated_at: '2026-10-16T00:00:01Z',
          updates: current().updates + 1
        };
        globalThis.__safariFixture__ = next;
        globalThis.sessionStorage.setItem('__safariFixture__', JSON.stringify(next));
        return {
          data: { id: 73006, updated_at: next.updated_at },
          error: null
        };
      },
      then(resolve, reject) {
        return Promise.resolve({ data: name === 'episodes' ?
          [episode()] : [], error: null }).then(resolve, reject);
      }
    };
    return builder;
  }
  const session = {
    user: { id: 'webkit-owner' }, access_token: 'webkit-test'
  };
  globalThis.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session }, error: null }) },
      from: table,
      rpc: async () => ({ data: true, error: null })
    })
  };
}


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
      body: '(' + provideMockSupabase.toString() + ')()'
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
  await expect(
    page.locator('.episode-inline-illustration-failed')
  ).toHaveCount(0);
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

test('iPhone Safari WebKit accepts PNG fallback from illustration canvas', async ({
  page,
  browserName
}) => {
  expect(browserName).toBe('webkit');
  await installFixture(page, '画像のない本文');
  await page.goto('/episode-edit.html?id=73006');
  await page.waitForFunction(
    () => !!globalThis.NovelightEpisodeIllustrations?.optimizeImage
  );
  const output = await page.evaluate(async () => {
    const proto = globalThis.HTMLCanvasElement.prototype;
    const toBlob = proto.toBlob;
    const original = globalThis.document.createElement('canvas');
    original.width = 2;
    original.height = 2;
    original.getContext('2d').fillRect(0, 0, 2, 2);
    const png = await new Promise((resolve) => {
      original.toBlob(resolve, 'image/png');
    });
    const source = new globalThis.File([png], 'author.png', {
      type: 'image/png'
    });
    proto.toBlob = function (done) {
      return toBlob.call(this, done, 'image/png');
    };
    try {
      const result =
        await globalThis.NovelightEpisodeIllustrations.optimizeImage(source);
      return {
        outputType: result.mimeType,
        blobType: result.blob.type,
        width: result.width,
        byteCount: result.blob.size
      };
    } finally {
      proto.toBlob = toBlob;
    }
  });
  expect(output.outputType).toBe('image/png');
  expect(output.blobType).toBe('image/png');
  expect(output.width).toBe(2);
  expect(output.byteCount).toBeGreaterThan(0);
});
