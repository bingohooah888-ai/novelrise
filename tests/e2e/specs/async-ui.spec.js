import { expect, test } from '../fixtures/diagnostic-fixture.js';

async function installSupabaseStub(page, overrides = {}) {
  await page.addInitScript((state) => {
    globalThis.__NOVELIGHT_E2E_STATE__ = state;
    globalThis.__NOVELIGHT_E2E_CALLS__ = [];
  }, overrides);

  await page.route(
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
        (() => {
          const state = window.__NOVELIGHT_E2E_STATE__ || {};
          const calls = window.__NOVELIGHT_E2E_CALLS__ || [];
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms || 0));
          const storedTableKey = '__novelight_e2e_table_overrides__';

          function errorFor(message) {
            return message ? { message } : null;
          }

          function hasOwn(object, key) {
            return Object.prototype.hasOwnProperty.call(object || {}, key);
          }

          function readStoredTables() {
            try {
              return JSON.parse(sessionStorage.getItem(storedTableKey) || '{}');
            } catch {
              return {};
            }
          }

          function writeStoredTables(tables) {
            sessionStorage.setItem(storedTableKey, JSON.stringify(tables));
          }

          function singleDataFor(table) {
            const storedTables = readStoredTables();
            if (hasOwn(storedTables, table)) return storedTables[table];
            if (hasOwn(state.singleData, table)) return state.singleData[table];
            const tableData = state.tableData?.[table];
            if (Array.isArray(tableData)) return tableData[0] || null;
            return tableData || null;
          }

          function persistUpdate(table, payload) {
            const storedTables = readStoredTables();
            storedTables[table] = {
              ...(singleDataFor(table) || {}),
              ...(payload || {})
            };
            writeStoredTables(storedTables);
          }

          function builder(table) {
            let operation = 'select';
            let mutationPayload = null;
            const api = {
              insert(payload) {
                operation = 'insert';
                mutationPayload = payload;
                calls.push({ type: 'insert', table, payload });
                return api;
              },
              update(payload) {
                operation = 'update';
                mutationPayload = payload;
                calls.push({ type: 'update', table, payload });
                return api;
              },
              delete() {
                operation = 'delete';
                calls.push({ type: 'delete', table });
                return api;
              },
              select() {
                return api;
              },
              eq(column, value) {
                calls.push({ type: 'eq', table, column, value, operation });
                return api;
              },
              neq() {
                return api;
              },
              in() {
                return api;
              },
              order() {
                return api;
              },
              limit() {
                return api;
              },
              single: async () => {
                if (operation === 'insert') {
                  await wait(state.insertDelayMs);
                  return {
                    data: state.insertData || { id: 'novel-e2e' },
                    error: errorFor(state.insertError)
                  };
                }
                await wait(state.selectDelayMs);
                return {
                  data: singleDataFor(table),
                  error: errorFor(
                    state.singleErrors?.[table] || state.tableErrors?.[table]
                  )
                };
              },
              maybeSingle: async () => ({
                data: state.maybeSingleData?.[table] || null,
                error: errorFor(state.maybeSingleErrors?.[table])
              }),
              then(resolve, reject) {
                const finish = async () => {
                  if (operation === 'update') {
                    await wait(state.updateDelayMs);
                    const error = errorFor(
                      state.updateErrors?.[table] || state.updateError
                    );
                    if (!error) persistUpdate(table, mutationPayload);
                    return { data: state.updateData?.[table] || null, error };
                  }
                  if (operation === 'delete') {
                    await wait(state.deleteDelayMs);
                    return {
                      data: null,
                      error: errorFor(
                        state.deleteErrors?.[table] || state.deleteError
                      )
                    };
                  }
                  if (operation === 'insert') {
                    await wait(state.insertDelayMs);
                    return {
                      data: state.insertData || null,
                      error: errorFor(state.insertError)
                    };
                  }
                  return {
                    data: state.tableData?.[table] || [],
                    error: errorFor(state.tableErrors?.[table])
                  };
                };
                return finish().then(resolve, reject);
              }
            };
            return api;
          }

          const client = {
            auth: {
              getSession: async () => {
                await wait(state.getSessionDelayMs);
                if (state.getSessionReject) {
                  throw new Error(state.getSessionReject);
                }
                return {
                  data: { session: state.session || null },
                  error: errorFor(state.getSessionError)
                };
              },
              signInWithPassword: async (payload) => {
                calls.push({ type: 'signInWithPassword', payload });
                await wait(state.authDelayMs);
                return {
                  data: { session: state.signInError ? null : state.session || null },
                  error: errorFor(state.signInError)
                };
              },
              signUp: async (payload) => {
                calls.push({ type: 'signUp', payload });
                await wait(state.authDelayMs);
                return {
                  data: { session: state.signupSession || null },
                  error: errorFor(state.signUpError)
                };
              },
              onAuthStateChange: () => ({
                data: { subscription: { unsubscribe() {} } }
              })
            },
            rpc: async (name, args) => {
              calls.push({ type: 'rpc', name, args });
              await wait(state.rpcDelayMs);
              const rpcData = state.rpcData || {};
              return {
                data: Object.prototype.hasOwnProperty.call(rpcData, name)
                  ? rpcData[name]
                  : true,
                error: errorFor(state.rpcErrors?.[name])
              };
            },
            from: (table) => builder(table)
          };

          window.supabase = { createClient: () => client };
        })();
      `
      });
    }
  );
}

function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('home discovery leaves the loading state after async data resolves', async ({
  page
}) => {
  await installSupabaseStub(page, {
    rpcDelayMs: 80,
    rpcData: {
      novelight_discovery_feed_v2: [],
      novelight_plan_extra_feed: []
    }
  });
  const pageErrors = collectPageErrors(page);

  await page.goto('/index.html');
  await expect(page.locator('#discoveryGrid')).toContainText(
    'まだ公開作品がありません。'
  );
  await expect(page.locator('#planExtraWrap')).toBeHidden();
  await expect(page.locator('#premiumWrap')).toBeHidden();
  expect(pageErrors).toEqual([]);
});

test('favorites renders a logged-in reader collection', async ({ page }) => {
  await installSupabaseStub(page, {
    session: { user: { id: 'reader-e2e' } },
    tableData: {
      favorites: [
        {
          novel_id: 'favorite-e2e',
          created_at: '2026-08-30T00:00:00Z',
          novels: {
            id: 'favorite-e2e',
            title: 'Favorite E2E Novel',
            genre: '現代ファンタジー',
            description: 'お気に入り正常系の回帰テストです。',
            pv: 12,
            status: 'published'
          }
        }
      ]
    }
  });
  const pageErrors = collectPageErrors(page);

  await page.goto('/favorites.html');

  await expect(page.locator('#list .card')).toHaveCount(1);
  await expect(page.locator('#list')).toContainText('Favorite E2E Novel');
  await expect(page.locator('#list')).not.toContainText('読み込み中...');
  expect(pageErrors).toEqual([]);
});

test('favorites redirects logged-out readers to login', async ({ page }) => {
  await installSupabaseStub(page);
  const pageErrors = collectPageErrors(page);

  await page.goto('/favorites.html');

  await expect(page).toHaveURL(/\/login\.html\?redirect=favorites\.html$/);
  expect(pageErrors).toEqual([]);
});

test('favorites leaves loading state when getSession rejects', async ({
  page
}) => {
  await installSupabaseStub(page, {
    getSessionReject: 'temporary auth lookup failure'
  });
  const pageErrors = collectPageErrors(page);

  await page.goto('/favorites.html');

  await expect(page.locator('#list')).toContainText(
    'お気に入り作品を表示できませんでした。通信状況を確認して、もう一度お試しください。'
  );
  await expect(page.locator('#list')).not.toContainText('読み込み中...');
  expect(pageErrors).toEqual([]);
});

test('favorites leaves loading state when favorites data loading fails', async ({
  page
}) => {
  await installSupabaseStub(page, {
    session: { user: { id: 'reader-e2e' } },
    tableErrors: { favorites: 'temporary database error' }
  });
  const pageErrors = collectPageErrors(page);

  await page.goto('/favorites.html');

  await expect(page.locator('#list')).toContainText(
    'お気に入り作品を表示できませんでした。通信状況を確認して、もう一度お試しください。'
  );
  await expect(page.locator('#list')).not.toContainText('読み込み中...');
  expect(pageErrors).toEqual([]);
});

test('login prevents duplicate submission while pending and recovers after an error', async ({
  page
}) => {
  await installSupabaseStub(page, {
    authDelayMs: 400,
    signInError: 'invalid credentials'
  });
  const pageErrors = collectPageErrors(page);

  await page.goto('/login.html');
  await page.locator('#email').fill('reader@example.com');
  await page.locator('#password').fill('password123');
  await page.locator('#loginButton').click();

  await expect(page.locator('#loginButton')).toBeDisabled();
  await expect(page.locator('#loginStatus')).toHaveText('ログイン中...');
  await expect(page.locator('#loginStatus')).toContainText(
    'ログインできませんでした。'
  );
  await expect(page.locator('#loginButton')).toBeEnabled();

  const signInCalls = await page.evaluate(
    () =>
      globalThis.__NOVELIGHT_E2E_CALLS__.filter(
        (call) => call.type === 'signInWithPassword'
      ).length
  );
  expect(signInCalls).toBe(1);
  expect(pageErrors).toEqual([]);
});

test('signup exposes loading state and restores the form after async completion', async ({
  page
}) => {
  await installSupabaseStub(page, { authDelayMs: 400 });
  const pageErrors = collectPageErrors(page);

  await page.goto('/signup.html');
  await page.locator('#name').fill('E2E Author');
  await page.locator('#email').fill('author@example.com');
  await page.locator('#password').fill('password123');
  await page.locator('#passwordConfirm').fill('password123');
  await page.locator('#termsConsent').check();
  await page.locator('#signupButton').click();

  await expect(page.locator('#signupButton')).toBeDisabled();
  await expect(page.locator('#signupStatus')).toHaveText('登録処理中...');
  await expect(page.locator('#signupStatus')).toContainText(
    '登録確認メールを送信しました。'
  );
  await expect(page.locator('#signupButton')).toBeEnabled();

  const signUpCalls = await page.evaluate(
    () =>
      globalThis.__NOVELIGHT_E2E_CALLS__.filter(
        (call) => call.type === 'signUp'
      ).length
  );
  expect(signUpCalls).toBe(1);
  expect(pageErrors).toEqual([]);
});

test('novel posting validates synchronously and recovers from an async save failure', async ({
  page
}) => {
  await installSupabaseStub(page, {
    session: { user: { id: 'author-e2e' } },
    insertDelayMs: 400,
    insertError: 'temporary database error'
  });
  const pageErrors = collectPageErrors(page);

  await page.goto('/post.html');
  await page.locator('#title').fill('E2E Novel');
  await page.locator('#genre').selectOption({ label: '現代ファンタジー' });
  await page.locator('#description').fill('非同期UI監査用のテスト作品です。');
  await page.locator('#aiUsage').selectOption('human');
  await page.locator('#contentRating').selectOption('mature');
  await page.locator('#policyAck').check();

  await page.locator('#submitButton').click();
  await expect(page.locator('#status')).toHaveText(
    '成熟したテーマには内容警告を1つ以上設定してください。'
  );

  const insertsBeforeWarning = await page.evaluate(
    () =>
      globalThis.__NOVELIGHT_E2E_CALLS__.filter(
        (call) => call.type === 'insert'
      ).length
  );
  expect(insertsBeforeWarning).toBe(0);

  await page.locator('#warningGrid input[value="violence"]').check();
  await page.locator('#submitButton').click();

  await expect(page.locator('#submitButton')).toBeDisabled();
  await expect(page.locator('#status')).toHaveText('保存しています...');
  await expect(page.locator('#status')).toHaveText(
    '作品を保存できませんでした。時間をおいて再度お試しください。'
  );
  await expect(page.locator('#submitButton')).toBeEnabled();

  const insertsAfterWarning = await page.evaluate(
    () =>
      globalThis.__NOVELIGHT_E2E_CALLS__.filter(
        (call) => call.type === 'insert'
      ).length
  );
  expect(insertsAfterWarning).toBe(1);
  expect(pageErrors).toEqual([]);
});

test('novel edit loads existing work, saves changes, and renders the update', async ({
  page
}) => {
  await installSupabaseStub(page, {
    session: { user: { id: 'author-e2e' } },
    updateDelayMs: 250,
    singleData: {
      novels: {
        id: 'novel-edit-e2e',
        user_id: 'author-e2e',
        title: '編集前の作品',
        genre: '現代ドラマ',
        description: '編集前のあらすじです。',
        ai_usage: 'human',
        content_rating: 'general',
        content_warnings: [],
        content_policy_ack: true,
        status: 'published',
        pv: 4,
        created_at: '2026-08-30T00:00:00Z'
      }
    },
    rpcData: {
      novelight_public_profile: [{ display_name: 'E2E Author' }],
      novelight_favorite_count: 0,
      light_seed_status: {
        reason: 'own_novel',
        monthly_limit: 5,
        remaining_this_month: 5,
        total_seed_count: 0
      }
    }
  });
  const pageErrors = collectPageErrors(page);

  await page.goto('/novel-edit.html?id=novel-edit-e2e');
  await expect(page.locator('#title')).toHaveValue('編集前の作品');
  await expect(page.locator('#description')).toHaveValue('編集前のあらすじです。');
  await expect(page.locator('#aiUsage')).toHaveValue('human');
  await expect(page.locator('#save')).toBeEnabled();

  await page.locator('#title').fill('編集後の作品');
  await page.locator('#description').fill('編集後のあらすじです。');
  await page.locator('#aiUsage').selectOption('ai_assisted');
  await page.locator('#contentRating').selectOption('mature');
  await page.locator('#warningGrid input[value="violence"]').check();
  await page.locator('#save').click();

  await expect(page.locator('#save')).toBeDisabled();
  await expect(page.locator('#status')).toHaveText('保存しています...');
  await page.waitForURL(/\/novel\.html\?id=novel-edit-e2e$/);
  await expect(page.locator('.title')).toHaveText('編集後の作品');
  await expect(page.locator('.description')).toHaveText('編集後のあらすじです。');
  await expect(page.locator('.tag.ai')).toHaveText('AI支援');

  const calls = await page.evaluate(() => globalThis.__NOVELIGHT_E2E_CALLS__);
  const updateCall = calls.find(
    (call) => call.type === 'update' && call.table === 'novels'
  );
  expect(updateCall?.payload).toMatchObject({
    title: '編集後の作品',
    description: '編集後のあらすじです。',
    ai_usage: 'ai_assisted',
    content_rating: 'mature',
    content_warnings: ['violence'],
    content_policy_ack: true
  });
  expect(
    calls
      .filter(
        (call) =>
          call.type === 'eq' &&
          call.table === 'novels' &&
          call.operation === 'update'
      )
      .map(({ column, value }) => [column, value])
  ).toEqual([
    ['id', 'novel-edit-e2e'],
    ['user_id', 'author-e2e']
  ]);
  expect(pageErrors).toEqual([]);
});

test('novel edit recovers after an async save failure', async ({ page }) => {
  await installSupabaseStub(page, {
    session: { user: { id: 'author-e2e' } },
    updateDelayMs: 300,
    updateErrors: { novels: 'temporary database error' },
    singleData: {
      novels: {
        id: 'novel-edit-failure-e2e',
        user_id: 'author-e2e',
        title: '保存失敗前の作品',
        genre: '現代ドラマ',
        description: '保存失敗テストのあらすじです。',
        ai_usage: 'human',
        content_rating: 'general',
        content_warnings: [],
        content_policy_ack: true
      }
    }
  });
  const pageErrors = collectPageErrors(page);

  await page.goto('/novel-edit.html?id=novel-edit-failure-e2e');
  await expect(page.locator('#save')).toBeEnabled();
  await page.locator('#title').fill('保存に失敗する作品');
  await page.locator('#save').click();

  await expect(page.locator('#save')).toBeDisabled();
  await expect(page.locator('#status')).toHaveText('保存しています...');
  await expect(page.locator('#status')).toHaveText(
    '保存できませんでした。時間をおいて再度お試しください。'
  );
  await expect(page.locator('#save')).toBeEnabled();
  await expect(page).toHaveURL(/\/novel-edit\.html\?id=novel-edit-failure-e2e$/);

  const updateCount = await page.evaluate(
    () =>
      globalThis.__NOVELIGHT_E2E_CALLS__.filter(
        (call) => call.type === 'update' && call.table === 'novels'
      ).length
  );
  expect(updateCount).toBe(1);
  expect(pageErrors).toEqual([]);
});

test('episode edit loads existing episode, saves changes, and renders the update', async ({
  page
}) => {
  await installSupabaseStub(page, {
    session: { user: { id: 'author-e2e' } },
    updateDelayMs: 250,
    singleData: {
      episodes: {
        id: 'episode-edit-e2e',
        novel_id: 'novel-for-episode-e2e',
        user_id: 'author-e2e',
        episode_number: 2,
        title: '編集前の第2話',
        content: '編集前の本文です。',
        pv: 2,
        status: 'published'
      },
      novels: {
        id: 'novel-for-episode-e2e',
        title: '親作品',
        user_id: 'author-e2e',
        status: 'published',
        content_rating: 'general',
        content_warnings: []
      }
    }
  });
  const pageErrors = collectPageErrors(page);

  await page.goto('/episode-edit.html?id=episode-edit-e2e');
  await expect(page.locator('#episodeNumber')).toHaveValue('2');
  await expect(page.locator('#title')).toHaveValue('編集前の第2話');
  await expect(page.locator('#content')).toHaveValue('編集前の本文です。');
  await expect(page.locator('#save')).toBeEnabled();

  await page.locator('#episodeNumber').fill('3');
  await page.locator('#title').fill('編集後の第3話');
  await page.locator('#content').fill('編集後の本文です。');
  await page.locator('#save').click();

  await expect(page.locator('#save')).toBeDisabled();
  await expect(page.locator('#status')).toHaveText('保存しています...');
  await page.waitForURL(/\/episode\.html\?id=episode-edit-e2e$/);
  await expect(page.locator('#card h1')).toHaveText('編集後の第3話');
  await expect(page.locator('#card .number')).toHaveText('第3話');
  await expect(page.locator('#card .content')).toHaveText('編集後の本文です。');

  const calls = await page.evaluate(() => globalThis.__NOVELIGHT_E2E_CALLS__);
  const updateCall = calls.find(
    (call) => call.type === 'update' && call.table === 'episodes'
  );
  expect(updateCall?.payload).toEqual({
    episode_number: 3,
    title: '編集後の第3話',
    content: '編集後の本文です。'
  });
  expect(
    calls
      .filter(
        (call) =>
          call.type === 'eq' &&
          call.table === 'episodes' &&
          call.operation === 'update'
      )
      .map(({ column, value }) => [column, value])
  ).toEqual([
    ['id', 'episode-edit-e2e'],
    ['user_id', 'author-e2e']
  ]);
  expect(pageErrors).toEqual([]);
});

test('episode edit recovers after an async save failure', async ({ page }) => {
  await installSupabaseStub(page, {
    session: { user: { id: 'author-e2e' } },
    updateDelayMs: 300,
    updateErrors: { episodes: 'temporary database error' },
    singleData: {
      episodes: {
        id: 'episode-edit-failure-e2e',
        novel_id: 'novel-for-failure-e2e',
        user_id: 'author-e2e',
        episode_number: 1,
        title: '保存失敗前の第1話',
        content: '保存失敗テストの本文です。'
      }
    }
  });
  const pageErrors = collectPageErrors(page);

  await page.goto('/episode-edit.html?id=episode-edit-failure-e2e');
  await expect(page.locator('#save')).toBeEnabled();
  await page.locator('#title').fill('保存に失敗する第1話');
  await page.locator('#save').click();

  await expect(page.locator('#save')).toBeDisabled();
  await expect(page.locator('#status')).toHaveText('保存しています...');
  await expect(page.locator('#status')).toHaveText(
    '保存できませんでした。時間をおいて再度お試しください。'
  );
  await expect(page.locator('#save')).toBeEnabled();
  await expect(page).toHaveURL(
    /\/episode-edit\.html\?id=episode-edit-failure-e2e$/
  );

  const updateCount = await page.evaluate(
    () =>
      globalThis.__NOVELIGHT_E2E_CALLS__.filter(
        (call) => call.type === 'update' && call.table === 'episodes'
      ).length
  );
  expect(updateCount).toBe(1);
  expect(pageErrors).toEqual([]);
});
