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

          function errorFor(message) {
            return message ? { message } : null;
          }

          function builder(table) {
            const api = {
              insert(payload) {
                calls.push({ type: 'insert', table, payload });
                return api;
              },
              update(payload) {
                calls.push({ type: 'update', table, payload });
                return api;
              },
              delete() {
                calls.push({ type: 'delete', table });
                return api;
              },
              select() {
                return api;
              },
              eq() {
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
                await wait(state.insertDelayMs);
                return {
                  data: state.insertData || { id: 'novel-e2e' },
                  error: errorFor(state.insertError)
                };
              },
              maybeSingle: async () => ({ data: null, error: null }),
              then(resolve, reject) {
                const result = {
                  data: state.tableData?.[table] || [],
                  error: errorFor(state.tableErrors?.[table])
                };
                return Promise.resolve(result).then(resolve, reject);
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
      novelight_trusted_discovery_feed: [],
      novelight_trusted_plan_extra_feed: []
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
    tableData: {
      novel_thumbnail_assets: [
        {
          id: 'thumb-e2e',
          label: 'E2E Official Thumbnail',
          image_url: 'https://example.test/e2e-thumbnail.webp'
        }
      ]
    },
    insertDelayMs: 400,
    insertError: 'temporary database error'
  });
  const pageErrors = collectPageErrors(page);

  await page.goto('/post.html');
  const thumbnailInput = page.locator(
    'input[name="thumbnailAsset"][value="thumb-e2e"]'
  );
  await page.getByText('E2E Official Thumbnail', { exact: true }).click();
  await expect(thumbnailInput).toBeChecked();
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

  const insertCalls = await page.evaluate(() =>
    globalThis.__NOVELIGHT_E2E_CALLS__.filter(
      (call) => call.type === 'insert'
    )
  );
  expect(insertCalls).toHaveLength(1);
  expect(insertCalls[0].payload.thumbnail_asset_id).toBe('thumb-e2e');
  expect(pageErrors).toEqual([]);
});
