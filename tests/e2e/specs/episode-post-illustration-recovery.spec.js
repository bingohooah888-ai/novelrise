import { expect, test } from '@playwright/test';

// All services are mocked locally: no Production or Staging mutations.
function installMockSupabase() {
  const owner = { id: '11111111-1111-4111-8111-111111111111' };
  const session = { user: owner, access_token: 'local-test-only' };
  const novel = {
    id: 123,
    user_id: owner.id,
    title: 'Illustration regression fixture',
    genre: 'fantasy',
    description: 'Fixture',
    status: 'published',
    content_rating: 'general',
    content_warnings: [],
    show_episode_numbers: true
  };
  function from(name) {
    return {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      order() {
        return this;
      },
      limit() {
        return this;
      },
      update() {
        return this;
      },
      single: async () => ({
        data: name === 'novels' ? novel : null,
        error: null
      }),
      maybeSingle: async () => ({ data: null, error: null }),
      then(resolve, reject) {
        return Promise.resolve({ data: [], error: null }).then(resolve, reject);
      }
    };
  }
  globalThis.supabase = {
    createClient() {
      return {
        from,
        storage: {
          from: () => ({ uploadToSignedUrl: async () => ({ error: null }) })
        },
        auth: { getSession: async () => ({ data: { session }, error: null }) },
        rpc: async (name) => {
          if (name === 'novelight_save_episode_draft') {
            globalThis.__draftSaves = (globalThis.__draftSaves || 0) + 1;
            if (globalThis.__failFirstSave && globalThis.__draftSaves === 1) {
              return {
                data: null,
                error: {
                  status: 503,
                  code: 'TEST_TEMPORARY',
                  message: 'Synthetic failed save'
                }
              };
            }
            return { data: 333, error: null };
          }
          return { data: true, error: null };
        }
      };
    }
  };
}

test.beforeEach(async ({ page }) => {
  await page.route('**/assets/vendor/supabase-js-2.112.3.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '(' + installMockSupabase.toString() + ')()'
    })
  );
  await page.route('**/novelight-client.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'globalThis.NovelightClient={recordVisit:async()=>{},claimAcquisition:async()=>{}};'
    })
  );
  await page.route('**/api/episode-illustrations', (route) => {
    const action = route.request().postDataJSON()?.action;
    let status = 200;
    let body;
    if (action === 'editor-list') {
      const calls = page.__editorCalls || 0;
      page.__editorCalls = calls + 1;
      status = (page.__editorStatuses || [])[calls] || 200;
      const id = '01234567-89ab-4cde-8f01-23456789abcd';
      body =
        status === 200
          ? {
              episodeId: 333,
              novelId: 123,
              isOwner: true,
              aiUsage: false,
              limit: 10,
              assets: page.__uploaded
                ? [
                    {
                      id,
                      marker: '[[NOVELIGHT_ILLUSTRATION:' + id + ']]',
                      url: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
                      width: 1,
                      height: 1,
                      altText: ''
                    }
                  ]
                : []
            }
          : { error: 'synthetic editor-list failure' };
    } else if (action === 'prepare-upload') {
      body = { path: 'synthetic/image.webp', token: 'synthetic' };
    } else if (action === 'finalize-upload') {
      page.__uploaded = true;
      body = { id: '01234567-89ab-4cde-8f01-23456789abcd' };
    } else {
      status = 400;
      body = { error: 'unexpected action' };
    }
    return route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  });
});

async function openNewPost(page) {
  await page.goto('/episode-post.html?novel_id=123');
  await expect(page.locator('#openIllustrationEditor')).toBeEnabled();
  await page.locator('#title').fill('挿絵の新規投稿検証');
  await page.locator('#content').fill('これは本文です。');
}

test('new post: failed draft save stays visible and retry resumes the illustration editor', async ({
  page
}) => {
  await openNewPost(page);
  await page.evaluate(() => {
    globalThis.__failFirstSave = true;
  });
  await page.locator('#openIllustrationEditor').click();
  const panel = page.locator('#episodeIllustrationsMount');
  await expect(panel.getByRole('alert')).toContainText(
    '下書きを保存できませんでした'
  );
  await expect(
    panel.getByRole('button', { name: '挿絵の準備を再試行' })
  ).toBeVisible();
  await expect(page.locator('#content')).toHaveValue('これは本文です。');
  await panel.getByRole('button', { name: '挿絵の準備を再試行' }).click();
  await expect(
    panel.getByRole('button', { name: '挿絵をアップロード' })
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => globalThis.__draftSaves || 0))
    .toBe(2);
});

test('new post: an editor API 503 recovers without exposing a blank panel', async ({
  page
}) => {
  page.__editorStatuses = [503, 200];
  await openNewPost(page);
  await page.locator('#openIllustrationEditor').click();
  await expect(
    page
      .locator('#episodeIllustrationsMount')
      .getByRole('button', { name: '挿絵をアップロード' })
  ).toBeVisible();
  expect(page.__editorCalls).toBe(2);
});

test('new post: synthetic PNG upload inserts marker and autosaves manuscript', async ({
  page
}) => {
  await openNewPost(page);
  await page.locator('#openIllustrationEditor').click();
  await expect(
    page.getByRole('button', { name: '挿絵をアップロード' })
  ).toBeVisible();
  const pngBase64 = await page.evaluate(() => {
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    canvas.getContext('2d').fillRect(0, 0, 4, 4);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page
    .locator('.episode-illustration-upload input[type=file]')
    .setInputFiles({
      name: 'synthetic.png',
      mimeType: 'image/png',
      buffer: Buffer.from(pngBase64, 'base64')
    });
  await page.getByRole('button', { name: '挿絵をアップロード' }).click();
  await expect(page.locator('#content')).toHaveValue(/NOVELIGHT_ILLUSTRATION:/);
  await expect
    .poll(() => page.evaluate(() => globalThis.__draftSaves || 0))
    .toBeGreaterThan(1);
});
