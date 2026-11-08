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
  const storedEpisode = () => {
    const stored = globalThis.localStorage.getItem('__fixtureSavedEpisode');
    return stored ? JSON.parse(stored) : null;
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
        data:
          name === 'novels'
            ? novel
            : name === 'episodes'
              ? {
                  id: 333,
                  novel_id: 123,
                  user_id: owner.id,
                  episode_number: 1,
                  title: '既存エピソード',
                  content: '既存の本文です。',
                  status: 'draft',
                  chapter_id: null,
                  scheduled_publish_at: null
                }
              : null,
        error: null
      }),
      maybeSingle: async () => ({
        data: name === 'episodes' ? storedEpisode() : null,
        error: null
      }),
      then(resolve, reject) {
        return Promise.resolve({ data: [], error: null }).then(resolve, reject);
      }
    };
  }
  globalThis.__testAuthSession = session;
  globalThis.supabase = {
    createClient() {
      return {
        from,
        storage: {
          from: () => ({ uploadToSignedUrl: async () => ({ error: null }) })
        },
        auth: {
          getSession: async () => ({
            data: { session: globalThis.__testAuthSession },
            error: null
          })
        },
        rpc: async (name, params) => {
          if (name === 'novelight_save_episode_draft') {
            globalThis.__draftSaves = (globalThis.__draftSaves || 0) + 1;
            if (globalThis.__testDraftSaveDelayMs)
              await new Promise((resolve) =>
                globalThis.setTimeout(
                  resolve,
                  globalThis.__testDraftSaveDelayMs
                )
              );
            if (globalThis.__failNextSave) {
              globalThis.__failNextSave = false;
              return {
                data: null,
                error: {
                  status: 503,
                  code: 'TEST_TEMPORARY',
                  message: 'Synthetic failed save'
                }
              };
            }
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
            globalThis.__lastSavedContent = params?.p_content;
            globalThis.localStorage.setItem(
              '__fixtureSavedEpisode',
              JSON.stringify({
                id: 333,
                novel_id: 123,
                user_id: owner.id,
                episode_number: Number(params?.p_episode_number) || 1,
                title: params?.p_title || '',
                content: params?.p_content || '',
                status: 'draft',
                chapter_id: null,
                scheduled_publish_at: null
              })
            );
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
    if (
      page.__requiredToken &&
      route.request().headers().authorization !==
        'Bearer ' + page.__requiredToken
    ) {
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"error":"stale token"}'
      });
    }
    (page.__observedActions ||= []).push(action);
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

test('new post: reopening drawer retries failed editor-list without saving another draft', async ({
  page
}) => {
  page.__editorStatuses = [403, 200];
  await openNewPost(page);
  await page.locator('#openIllustrationEditor').click();
  const panel = page.locator('#episodeIllustrationsMount');
  await expect(
    panel.getByRole('button', { name: '挿絵を再読み込み' })
  ).toBeVisible();
  expect(page.__editorCalls).toBe(1);
  const savesBeforeRetry = await page.evaluate(
    () => globalThis.__draftSaves || 0
  );

  await page.locator('#closeDrawer').click();
  await page.locator('#openIllustrationEditor').click();
  await expect(
    panel.getByRole('button', { name: '挿絵をアップロード' })
  ).toBeVisible();
  expect(page.__editorCalls).toBe(2);
  expect(await page.evaluate(() => globalThis.__draftSaves || 0)).toBe(
    savesBeforeRetry
  );

  await page.locator('#closeDrawer').click();
  await page.locator('#openIllustrationEditor').click();
  expect(page.__editorCalls).toBe(2);
});

test('new post: repeat failure keeps manual retry, and recovered drawer stays mounted', async ({
  page
}) => {
  page.__editorStatuses = [403, 403, 200];
  await openNewPost(page);
  await page.locator('#openIllustrationEditor').click();
  const panel = page.locator('#episodeIllustrationsMount');
  await expect(
    panel.getByRole('button', { name: '挿絵を再読み込み' })
  ).toBeVisible();

  await page.locator('#closeDrawer').click();
  await page.locator('#openIllustrationEditor').click();
  await expect(
    panel.getByRole('button', { name: '挿絵を再読み込み' })
  ).toBeVisible();
  expect(page.__editorCalls).toBe(2);

  await panel.getByRole('button', { name: '挿絵を再読み込み' }).click();
  await expect(
    panel.getByRole('button', { name: '挿絵をアップロード' })
  ).toBeVisible();
  expect(page.__editorCalls).toBe(3);

  await page.locator('#closeDrawer').click();
  await page.locator('#openIllustrationEditor').click();
  expect(page.__editorCalls).toBe(3);
});

test('new post: reopening an existing illustration panel flushes edited manuscript instead of cancelling autosave', async ({
  page
}) => {
  await openNewPost(page);
  await page.locator('#openIllustrationEditor').click();
  await expect(
    page.getByRole('button', { name: '挿絵をアップロード' })
  ).toBeVisible();
  const before = await page.evaluate(() => globalThis.__draftSaves || 0);
  await page.locator('#closeDrawer').click();
  await page.locator('#content').fill('本文を変更した直後でも保存されます。');
  await page.locator('#openIllustrationEditor').click();
  await expect(page.locator('#content')).toHaveValue(
    '本文を変更した直後でも保存されます。'
  );
  await expect
    .poll(() => page.evaluate(() => globalThis.__draftSaves || 0))
    .toBe(before + 1);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => globalThis.__draftSaves || 0)).toBe(
    before + 1
  );
});

test('new post: retrying failed illustration list also flushes subsequent edits', async ({
  page
}) => {
  page.__editorStatuses = [403, 200];
  await openNewPost(page);
  await page.locator('#openIllustrationEditor').click();
  await expect(
    page.getByRole('button', { name: '挿絵を再読み込み' })
  ).toBeVisible();
  const before = await page.evaluate(() => globalThis.__draftSaves || 0);
  await page.locator('#closeDrawer').click();
  await page.locator('#content').fill('挿絵再試行の前に更新した本文です。');
  await page.locator('#openIllustrationEditor').click();
  await expect(
    page.getByRole('button', { name: '挿絵をアップロード' })
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => globalThis.__draftSaves || 0))
    .toBe(before + 1);
  expect(page.__editorCalls).toBe(2);
});

test('new post: save failure after mounting preserves the panel and can recover', async ({
  page
}) => {
  await openNewPost(page);
  await page.locator('#openIllustrationEditor').click();
  await expect(
    page.getByRole('button', { name: '挿絵をアップロード' })
  ).toBeVisible();
  await page.locator('#closeDrawer').click();
  await page.locator('#content').fill('保存失敗後も失われない本文');
  await page.evaluate(() => {
    globalThis.__failNextSave = true;
  });
  await page.locator('#openIllustrationEditor').click();
  await expect(
    page.getByRole('button', { name: '挿絵をアップロード' })
  ).toBeVisible();
  await expect(page.locator('#content')).toHaveValue(
    '保存失敗後も失われない本文'
  );
  await expect(page.locator('#status')).toContainText('保存できませんでした');
  await page.locator('#closeDrawer').click();
  await page.locator('#openIllustrationEditor').click();
  await expect(page.locator('#saveState')).toContainText('保存済み');
});

test('new post: API retry uses the refreshed access token after a 401', async ({
  page
}) => {
  await page.route('**/api/episode-illustrations', (route) => {
    const request = route.request();
    const valid = request.headers().authorization === 'Bearer fresh-token';
    const body = valid
      ? {
          episodeId: 333,
          novelId: 123,
          isOwner: true,
          aiUsage: false,
          limit: 10,
          assets: []
        }
      : { error: 'Authorization expired' };
    return route.fulfill({
      status: valid ? 200 : 401,
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  });
  await openNewPost(page);
  await page.locator('#openIllustrationEditor').click();
  await expect(
    page.getByRole('button', { name: '挿絵を再読み込み' })
  ).toBeVisible();
  await page.evaluate(() => {
    globalThis.__testAuthSession = {
      ...globalThis.__testAuthSession,
      access_token: 'fresh-token'
    };
  });
  await page.locator('#closeDrawer').click();
  await page.locator('#openIllustrationEditor').click();
  await expect(
    page.getByRole('button', { name: '挿絵をアップロード' })
  ).toBeVisible();
});

test('new post: upload registration inserts an illustration even if the following list refresh fails', async ({
  page
}) => {
  page.__editorStatuses = [200, 503, 503, 503, 503, 200];
  await openNewPost(page);
  await page.locator('#openIllustrationEditor').click();
  await expect(
    page.getByRole('button', { name: '挿絵をアップロード' })
  ).toBeVisible();
  const before = await page.evaluate(() => globalThis.__draftSaves || 0);
  const pngBase64 = await page.evaluate(() => {
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = 3;
    canvas.height = 3;
    canvas.getContext('2d').fillRect(0, 0, 3, 3);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page
    .locator('.episode-illustration-upload input[type=file]')
    .setInputFiles({
      name: 'regression.png',
      mimeType: 'image/png',
      buffer: Buffer.from(pngBase64, 'base64')
    });
  await page.getByRole('button', { name: '挿絵をアップロード' }).click();
  await expect(page.locator('#content')).toHaveValue(
    /NOVELIGHT_ILLUSTRATION:01234567-89ab-4cde-8f01-23456789abcd/
  );
  await expect
    .poll(() => page.evaluate(() => globalThis.__draftSaves || 0))
    .toBeGreaterThan(before);
  expect(page.__uploaded).toBe(true);
  expect(page.__editorCalls).toBe(5);
  await page.locator('#closeDrawer').click();
  await page.locator('#openIllustrationEditor').click();
  await expect(page.getByText('本文で使用中')).toBeVisible();
  expect(page.__editorCalls).toBe(6);
});

test('new post: inserted illustration marker remains in restored saved draft after reload', async ({
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
      name: 'restored.png',
      mimeType: 'image/png',
      buffer: Buffer.from(pngBase64, 'base64')
    });
  await page.getByRole('button', { name: '挿絵をアップロード' }).click();
  await expect
    .poll(() => page.evaluate(() => globalThis.__lastSavedContent || ''))
    .toContain(
      '[[NOVELIGHT_ILLUSTRATION:01234567-89ab-4cde-8f01-23456789abcd]]'
    );
  expect(new globalThis.URL(page.url()).searchParams.get('draft_id')).toBe(
    '333'
  );
  await page.reload();
  await expect(page.locator('#openIllustrationEditor')).toBeEnabled();
  await expect(page.locator('#content')).toHaveValue(
    /NOVELIGHT_ILLUSTRATION:01234567-89ab-4cde-8f01-23456789abcd/
  );
  await page.locator('#openIllustrationEditor').click();
  await expect(page.getByText('本文で使用中')).toBeVisible();
});

async function openEditIllustrationFixture(page) {
  await page.route('**/novelight-characters.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'globalThis.NovelightCharacters={mountEpisodeEditor:async()=>{}};'
    })
  );
  await page.goto('/episode-edit.html?id=333');
  await expect(page.locator('#openIllustrationEditor')).toBeEnabled();
}

test('existing draft edit: reopening a failed illustration list retries successfully', async ({
  page
}) => {
  page.__editorStatuses = [403, 200];
  await openEditIllustrationFixture(page);
  await page.locator('#openIllustrationEditor').click();
  await expect(
    page.getByRole('button', { name: '挿絵を再読み込み' })
  ).toBeVisible();
  await page.locator('#closeDrawer').click();
  await page.locator('#openIllustrationEditor').click();
  await expect(
    page.getByRole('button', { name: '挿絵をアップロード' })
  ).toBeVisible();
  expect(page.__editorCalls).toBe(2);
});

test('existing draft edit: missing session displays in-panel recovery and succeeds on retry', async ({
  page
}) => {
  await openEditIllustrationFixture(page);
  await page.evaluate(() => {
    globalThis.__savedAuthSession = globalThis.__testAuthSession;
    globalThis.__testAuthSession = null;
  });
  await page.locator('#openIllustrationEditor').click();
  await expect(
    page.getByRole('button', { name: '挿絵の準備を再試行' })
  ).toBeVisible();
  await page.evaluate(() => {
    globalThis.__testAuthSession = globalThis.__savedAuthSession;
  });
  await page.getByRole('button', { name: '挿絵の準備を再試行' }).click();
  await expect(
    page.getByRole('button', { name: '挿絵をアップロード' })
  ).toBeVisible();
});

test('new post: upload prepare and finalize use the current rotated access token', async ({
  page
}) => {
  await openNewPost(page);
  await page.locator('#openIllustrationEditor').click();
  await expect(
    page.getByRole('button', { name: '挿絵をアップロード' })
  ).toBeVisible();
  page.__requiredToken = 'fresh-upload-token';
  await page.evaluate(() => {
    globalThis.__testAuthSession = {
      ...globalThis.__testAuthSession,
      access_token: 'fresh-upload-token'
    };
  });
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
      name: 'auth-refresh.png',
      mimeType: 'image/png',
      buffer: Buffer.from(pngBase64, 'base64')
    });
  await page.getByRole('button', { name: '挿絵をアップロード' }).click();
  await expect(page.locator('#content')).toHaveValue(
    /NOVELIGHT_ILLUSTRATION:01234567-89ab-4cde-8f01-23456789abcd/
  );
  expect(page.__observedActions).toContain('prepare-upload');
  expect(page.__observedActions).toContain('finalize-upload');
});

test('new post: after finalize and repeated editor-list failures upload controls recover immediately', async ({
  page
}) => {
  page.__editorStatuses = [200, 503, 503, 503, 503, 200];
  await openNewPost(page);
  await page.locator('#openIllustrationEditor').click();
  await expect(
    page.getByRole('button', { name: '挿絵をアップロード' })
  ).toBeEnabled();
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
      name: 'refresh-failure.png',
      mimeType: 'image/png',
      buffer: Buffer.from(pngBase64, 'base64')
    });
  await page.getByRole('button', { name: '挿絵をアップロード' }).click();
  await expect(page.locator('#content')).toHaveValue(/NOVELIGHT_ILLUSTRATION:/);
  await expect.poll(() => page.__editorCalls).toBe(5);
  await expect(
    page.getByRole('button', { name: '挿絵をアップロード' })
  ).toBeEnabled();
  await expect(
    page.locator('.episode-illustration-upload input[type=file]')
  ).toBeEnabled();
  await page.locator('#closeDrawer').click();
  await page.locator('#openIllustrationEditor').click();
  await expect(page.getByText('本文で使用中')).toBeVisible();
  expect(page.__editorCalls).toBe(6);
});

test('new post: failed prepare-upload also restores buttons after refresh', async ({
  page
}) => {
  await page.route('**/api/episode-illustrations', (route) => {
    if (route.request().postDataJSON()?.action === 'prepare-upload') {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Temporary upload preparation failure' })
      });
    }
    return route.fallback();
  });
  await openNewPost(page);
  await page.locator('#openIllustrationEditor').click();
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
      name: 'prepare-failure.png',
      mimeType: 'image/png',
      buffer: Buffer.from(pngBase64, 'base64')
    });
  await page.getByRole('button', { name: '挿絵をアップロード' }).click();
  await expect(
    page.locator('.episode-illustration-upload input[type=file]')
  ).toBeEnabled();
  await expect(
    page.getByRole('button', { name: '挿絵をアップロード' })
  ).toBeEnabled();
  await expect(page.locator('#content')).not.toHaveValue(
    /NOVELIGHT_ILLUSTRATION:/
  );
});

test('new post: two immediate illustration requests share one initial draft and editor', async ({
  page
}) => {
  await openNewPost(page);
  await page.evaluate(() => {
    const button = globalThis.document.getElementById('openIllustrationEditor');
    button.click();
    button.click();
  });
  await expect(
    page.getByRole('button', { name: '挿絵をアップロード' })
  ).toBeVisible();
  await expect.poll(() => page.__editorCalls).toBe(1);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => globalThis.__draftSaves || 0)).toBe(1);
  expect(page.__editorCalls).toBe(1);
});

test('new post: overlapping autosave and repeated opening does not mount twice', async ({
  page
}) => {
  await openNewPost(page);
  await page.evaluate(() => {
    globalThis.__testDraftSaveDelayMs = 650;
  });
  await expect
    .poll(() => page.evaluate(() => globalThis.__draftSaves || 0))
    .toBe(1);
  await page.evaluate(() => {
    const button = globalThis.document.getElementById('openIllustrationEditor');
    button.click();
    button.click();
  });
  await expect(
    page.getByRole('button', { name: '挿絵をアップロード' })
  ).toBeVisible();
  expect(page.__editorCalls).toBe(1);
  expect(await page.evaluate(() => globalThis.__draftSaves || 0)).toBe(1);
});

test('existing draft edit: two immediate illustration requests mount once', async ({
  page
}) => {
  await openEditIllustrationFixture(page);
  await page.evaluate(() => {
    const button = globalThis.document.getElementById('openIllustrationEditor');
    button.click();
    button.click();
  });
  await expect(
    page.getByRole('button', { name: '挿絵をアップロード' })
  ).toBeVisible();
  await page.waitForTimeout(350);
  expect(page.__editorCalls).toBe(1);
});

test('new post: physical double-click keeps the drawer open and permits normal dismissal', async ({
  page,
  isMobile
}) => {
  await openNewPost(page);
  await page.locator('#openIllustrationEditor').dblclick({ delay: 60 });
  await expect(
    page.getByRole('button', { name: '挿絵をアップロード' })
  ).toBeVisible();
  await expect(page.locator('#settingsDrawer')).toHaveAttribute(
    'aria-hidden',
    'false'
  );
  expect(page.__editorCalls).toBe(1);
  expect(await page.evaluate(() => globalThis.__draftSaves || 0)).toBe(1);
  await page.waitForTimeout(650);
  if (isMobile) await page.locator('#closeDrawer').click();
  else await page.locator('#drawerBackdrop').click();
  await expect(page.locator('#settingsDrawer')).toHaveAttribute(
    'aria-hidden',
    'true'
  );
});

test('new post: physical double-click during slow autosave keeps one editor', async ({
  page
}) => {
  await openNewPost(page);
  await page.evaluate(() => {
    globalThis.__testDraftSaveDelayMs = 450;
  });
  await expect
    .poll(() => page.evaluate(() => globalThis.__draftSaves || 0))
    .toBe(1);
  await page.locator('#openIllustrationEditor').dblclick({ delay: 60 });
  await expect(
    page.getByRole('button', { name: '挿絵をアップロード' })
  ).toBeVisible();
  expect(page.__editorCalls).toBe(1);
});

test('existing draft edit: physical double-click keeps illustration drawer open', async ({
  page
}) => {
  await openEditIllustrationFixture(page);
  await page.locator('#openIllustrationEditor').dblclick({ delay: 60 });
  await expect(
    page.getByRole('button', { name: '挿絵をアップロード' })
  ).toBeVisible();
  await expect(page.locator('#settingsDrawer')).toHaveAttribute(
    'aria-hidden',
    'false'
  );
  expect(page.__editorCalls).toBe(1);
});

test('AI declaration success survives consecutive list failures and reopens with fresh state', async ({
  page
}) => {
  let declared = false;
  let afterSaveFailures = 0;
  let listCalls = 0;
  await page.route('**/api/episode-illustrations', (route) => {
    const action = route.request().postDataJSON()?.action;
    if (action === 'set-ai-usage') {
      declared = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"ok":true}'
      });
    }
    if (action === 'editor-list') {
      listCalls += 1;
      if (declared && afterSaveFailures++ < 2) {
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"error":"temporary list failure"}'
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          episodeId: 333,
          novelId: 123,
          isOwner: true,
          aiUsage: declared ? true : null,
          limit: 10,
          assets: []
        })
      });
    }
    return route.fallback();
  });
  await openNewPost(page);
  await page.locator('#openIllustrationEditor').click();
  await expect(
    page.locator('.episode-illustration-upload input[type=file]')
  ).toBeDisabled();
  await page
    .getByRole('combobox', { name: '挿絵のAI利用申告' })
    .selectOption('true');
  await page.getByRole('button', { name: '設定を保存' }).click();
  await expect.poll(() => listCalls).toBe(3);
  await expect(
    page.locator('.episode-illustration-status').last()
  ).toContainText('保存されました');
  await expect(
    page.locator('.episode-illustration-upload input[type=file]')
  ).toBeEnabled();
  await page.locator('#closeDrawer').click();
  await page.locator('#openIllustrationEditor').click();
  await expect.poll(() => listCalls).toBe(4);
  await expect(
    page.locator('.episode-illustration-upload input[type=file]')
  ).toBeEnabled();
});

test('deleted illustration vanishes even if list fails and reopen retries', async ({
  page
}) => {
  let deleted = false;
  let afterDeleteFailures = 0;
  let listCalls = 0;
  const id = '01234567-89ab-4cde-8f01-23456789abcd';
  page.on('dialog', (dialog) => dialog.accept());
  await page.route('**/api/episode-illustrations', (route) => {
    const action = route.request().postDataJSON()?.action;
    if (action === 'delete') {
      deleted = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"deleted":true}'
      });
    }
    if (action === 'editor-list') {
      listCalls++;
      if (deleted && afterDeleteFailures++ < 2) {
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"error":"temporary list failure"}'
        });
      }
      const assets = deleted
        ? []
        : [
            {
              id,
              marker: '[[NOVELIGHT_ILLUSTRATION:' + id + ']]',
              altText: 'Unused uploaded image',
              url: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
              width: 1,
              height: 1
            }
          ];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          episodeId: 333,
          novelId: 123,
          isOwner: true,
          aiUsage: false,
          limit: 10,
          assets
        })
      });
    }
    return route.fallback();
  });
  await openNewPost(page);
  await page.locator('#openIllustrationEditor').click();
  await expect(page.getByRole('button', { name: '削除' })).toBeVisible();
  await page.getByRole('button', { name: '削除' }).click();
  await expect.poll(() => listCalls).toBe(3);
  await expect(page.getByRole('button', { name: '削除' })).toHaveCount(0);
  await expect(
    page.locator('.episode-illustration-status').last()
  ).toContainText('削除されました');
  await page.locator('#closeDrawer').click();
  await page.locator('#openIllustrationEditor').click();
  await expect.poll(() => listCalls).toBe(4);
  await expect(page.locator('[data-illustration-count]')).toHaveText(
    '0 / 10枚'
  );
});

test('failed preparation preserves selected image and alt text for retry', async ({
  page
}) => {
  await page.route('**/api/episode-illustrations', (route) => {
    if (route.request().postDataJSON()?.action === 'prepare-upload') {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"temporary failure"}'
      });
    }
    return route.fallback();
  });
  await openNewPost(page);
  await page.locator('#openIllustrationEditor').click();
  const base64 = await page.evaluate(() => {
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    canvas.getContext('2d').fillRect(0, 0, 4, 4);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const fileInput = page.locator(
    '.episode-illustration-upload input[type=file]'
  );
  await fileInput.setInputFiles({
    name: 'retry.png',
    mimeType: 'image/png',
    buffer: Buffer.from(base64, 'base64')
  });
  const alt = page.locator('.episode-illustration-upload input[type=text]');
  await alt.fill('保存したい代替テキスト');
  await page.getByRole('button', { name: '挿絵をアップロード' }).click();
  await expect(
    page.getByRole('button', { name: '挿絵をアップロード' })
  ).toBeEnabled();
  await expect
    .poll(() => fileInput.evaluate((el) => el.files?.[0]?.name || ''))
    .toBe('retry.png');
  await expect(alt).toHaveValue('保存したい代替テキスト');
});

test('alt text edited while saving remains visibly unsaved after original request commits', async ({
  page
}) => {
  page.__uploaded = true;
  let resolveStarted;
  const started = new Promise((resolve) => {
    resolveStarted = resolve;
  });
  let serverAlt;
  await page.route('**/api/episode-illustrations', async (route) => {
    if (route.request().postDataJSON()?.action === 'update-alt') {
      serverAlt = route.request().postDataJSON().altText;
      resolveStarted();
      await new Promise((resolve) => globalThis.setTimeout(resolve, 400));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"ok":true}'
      });
    }
    return route.fallback();
  });
  await openNewPost(page);
  await page.locator('#openIllustrationEditor').click();
  const alt = page.locator(
    '.episode-illustration-item input[aria-label="挿絵の代替テキスト"]'
  );
  await alt.fill('最初に送信した文章');
  await page.getByRole('button', { name: '代替テキストを保存' }).click();
  await started;
  await alt.fill('送信中に書き換えた文章');
  await expect(
    page.locator('.episode-illustration-status').last()
  ).toContainText('未保存');
  expect(
    await page.locator('.episode-illustration-item img').getAttribute('alt')
  ).toBe(serverAlt);
  await expect(alt).toHaveValue('送信中に書き換えた文章');
});

test('deleting an illustration blocks insertion during the pending request', async ({
  page
}) => {
  page.__uploaded = true;
  let resolveStarted, releaseDelete;
  const started = new Promise((resolve) => {
    resolveStarted = resolve;
  });
  const gate = new Promise((resolve) => {
    releaseDelete = resolve;
  });
  page.on('dialog', (dialog) => dialog.accept());
  let deleted = false;
  await page.route('**/api/episode-illustrations', async (route) => {
    const action = route.request().postDataJSON()?.action;
    if (action === 'delete') {
      resolveStarted();
      await gate;
      deleted = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"deleted":true}'
      });
    }
    if (action === 'editor-list' && deleted) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          episodeId: 333,
          novelId: 123,
          isOwner: true,
          aiUsage: false,
          limit: 10,
          assets: []
        })
      });
    }
    return route.fallback();
  });
  await openNewPost(page);
  await page.locator('#openIllustrationEditor').click();
  await page.getByRole('button', { name: '削除' }).click();
  await started;
  await expect(
    page.getByRole('button', { name: 'カーソル位置へ挿入' })
  ).toBeDisabled();
  releaseDelete();
  await expect.poll(() => deleted).toBe(true);
  await expect(page.getByRole('button', { name: '削除' })).toHaveCount(0);
  await expect(page.locator('#content')).not.toHaveValue(
    /NOVELIGHT_ILLUSTRATION:/
  );
});

test('failed upload preparation retries the same selected file without reselecting', async ({
  page
}) => {
  let prepareCalls = 0;
  await page.route('**/api/episode-illustrations', (route) => {
    if (route.request().postDataJSON()?.action === 'prepare-upload') {
      prepareCalls++;
      if (prepareCalls === 1) {
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"error":"temporary"}'
        });
      }
    }
    return route.fallback();
  });
  await openNewPost(page);
  await page.locator('#openIllustrationEditor').click();
  const base64 = await page.evaluate(() => {
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    canvas.getContext('2d').fillRect(0, 0, 4, 4);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page
    .locator('.episode-illustration-upload input[type=file]')
    .setInputFiles({
      name: 'same-image.png',
      mimeType: 'image/png',
      buffer: Buffer.from(base64, 'base64')
    });
  await page
    .locator('.episode-illustration-upload input[type=text]')
    .fill('保持した説明文');
  await page.getByRole('button', { name: '挿絵をアップロード' }).click();
  await expect
    .poll(() =>
      page
        .locator('.episode-illustration-upload input[type=file]')
        .evaluate((input) => input.files?.[0]?.name)
    )
    .toBe('same-image.png');
  await page.getByRole('button', { name: '挿絵をアップロード' }).click();
  await expect(page.locator('#content')).toHaveValue(/NOVELIGHT_ILLUSTRATION:/);
  expect(prepareCalls).toBe(2);
});
