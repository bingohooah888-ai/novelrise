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
              getSession: async () => ({
                data: { session: state.session || null },
                error: null
              }),
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
  await expect(page.locator('#status')).toHaveText('temporary database error');
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
