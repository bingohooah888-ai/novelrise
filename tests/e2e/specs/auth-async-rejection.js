import { expect, test } from '../fixtures/diagnostic-fixture.js';

async function installAuthResilienceStubs(page, overrides = {}) {
  await page.addInitScript((state) => {
    globalThis.__NOVELIGHT_AUTH_E2E_STATE__ = state;
    globalThis.__NOVELIGHT_AUTH_E2E_CALLS__ = [];
  }, overrides);

  await page.route(
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
        (() => {
          const state = window.__NOVELIGHT_AUTH_E2E_STATE__ || {};
          const calls = window.__NOVELIGHT_AUTH_E2E_CALLS__ || [];
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms || 0));
          const errorFor = (message) => message ? { message } : null;
          const count = (type) => calls.filter((call) => call.type === type).length;

          const client = {
            auth: {
              getSession: async () => {
                calls.push({ type: 'getSession' });
                await wait(state.authDelayMs);
                if (state.getSessionReject) throw new Error(state.getSessionReject);
                return {
                  data: { session: state.session || null },
                  error: errorFor(state.getSessionError)
                };
              },
              signInWithPassword: async (payload) => {
                calls.push({ type: 'signInWithPassword', payload });
                await wait(state.authDelayMs);
                if (count('signInWithPassword') <= (state.signInRejectTimes || 0)) {
                  throw new Error('temporary sign-in network failure');
                }
                return {
                  data: { session: state.session || null },
                  error: errorFor(state.signInError)
                };
              },
              signUp: async (payload) => {
                calls.push({ type: 'signUp', payload });
                await wait(state.authDelayMs);
                if (count('signUp') <= (state.signUpRejectTimes || 0)) {
                  throw new Error('temporary signup network failure');
                }
                return {
                  data: { session: state.signupSession || null },
                  error: errorFor(state.signUpError)
                };
              },
              resetPasswordForEmail: async (email, options) => {
                calls.push({ type: 'resetPasswordForEmail', email, options });
                await wait(state.authDelayMs);
                if (state.resetPasswordReject) {
                  throw new Error(state.resetPasswordReject);
                }
                return { data: {}, error: errorFor(state.resetPasswordError) };
              },
              updateUser: async (payload) => {
                calls.push({ type: 'updateUser', payload });
                await wait(state.authDelayMs);
                if (count('updateUser') <= (state.updateUserRejectTimes || 0)) {
                  throw new Error('temporary password update failure');
                }
                return { data: {}, error: errorFor(state.updateUserError) };
              },
              signOut: async (options) => {
                calls.push({ type: 'signOut', options });
                await wait(state.authDelayMs);
                if (state.signOutReject) throw new Error(state.signOutReject);
                return { error: errorFor(state.signOutError) };
              },
              onAuthStateChange: (callback) => {
                window.__NOVELIGHT_RECOVERY_CALLBACK__ = callback;
                return { data: { subscription: { unsubscribe() {} } } };
              }
            }
          };

          window.supabase = { createClient: () => client };
        })();
      `
      });
    }
  );

  await page.route('**/novelight-client.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
      (() => {
        const state = window.__NOVELIGHT_AUTH_E2E_STATE__ || {};
        const calls = window.__NOVELIGHT_AUTH_E2E_CALLS__ || [];
        const optional = async (type, rejectKey) => {
          calls.push({ type });
          if (state[rejectKey]) throw new Error(state[rejectKey]);
          return true;
        };
        window.NovelightClient = {
          captureAcquisition: () => optional('captureAcquisition', 'captureReject'),
          recordVisit: () => optional('recordVisit', 'visitReject'),
          claimAcquisition: () => optional('claimAcquisition', 'claimReject')
        };
      })();
    `
    });
  });
}

function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function fillLogin(page) {
  await page.locator('#email').fill('reader@example.com');
  await page.locator('#password').fill('password123');
}

async function fillSignup(page) {
  await page.locator('#name').fill('E2E Author');
  await page.locator('#email').fill('author@example.com');
  await page.locator('#password').fill('password123');
  await page.locator('#passwordConfirm').fill('password123');
  await page.locator('#termsConsent').check();
}

test('login recovers after the auth promise rejects and permits a retry', async ({
  page
}) => {
  await installAuthResilienceStubs(page, {
    authDelayMs: 120,
    signInRejectTimes: 1,
    signInError: 'invalid credentials'
  });
  const pageErrors = collectPageErrors(page);

  await page.goto('/login.html');
  await fillLogin(page);
  await page.locator('#loginButton').click();
  await expect(page.locator('#loginButton')).toBeDisabled();
  await page.locator('#loginForm').evaluate((form) => form.requestSubmit());

  await expect(page.locator('#loginStatus')).toContainText('通信状態を確認');
  await expect(page.locator('#loginButton')).toBeEnabled();

  let signInCalls = await page.evaluate(
    () =>
      globalThis.__NOVELIGHT_AUTH_E2E_CALLS__.filter(
        (call) => call.type === 'signInWithPassword'
      ).length
  );
  expect(signInCalls).toBe(1);

  await page.locator('#loginButton').click();
  await expect(page.locator('#loginStatus')).toContainText(
    'メールアドレスとパスワードを確認してください。'
  );
  await expect(page.locator('#loginButton')).toBeEnabled();

  signInCalls = await page.evaluate(
    () =>
      globalThis.__NOVELIGHT_AUTH_E2E_CALLS__.filter(
        (call) => call.type === 'signInWithPassword'
      ).length
  );
  expect(signInCalls).toBe(2);
  expect(pageErrors).toEqual([]);
});

test('successful login is not blocked by rejected optional telemetry', async ({
  page
}) => {
  await installAuthResilienceStubs(page, {
    session: { user: { id: 'reader-e2e' } },
    captureReject: 'capture unavailable',
    claimReject: 'claim unavailable',
    visitReject: 'visit unavailable'
  });
  await page.route('**/mypage.html', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>redirect complete</title>'
    });
  });
  const pageErrors = collectPageErrors(page);

  await page.goto('/login.html');
  await fillLogin(page);
  await page.locator('#loginButton').click();

  await expect(page).toHaveURL(/\/mypage\.html$/);
  expect(pageErrors).toEqual([]);
});

test('signup recovers after the auth promise rejects and permits a retry', async ({
  page
}) => {
  await installAuthResilienceStubs(page, {
    authDelayMs: 120,
    signUpRejectTimes: 1,
    signUpError: 'invalid signup'
  });
  const pageErrors = collectPageErrors(page);

  await page.goto('/signup.html');
  await fillSignup(page);
  await page.locator('#signupButton').click();
  await expect(page.locator('#signupButton')).toBeDisabled();
  await page.locator('#signupForm').evaluate((form) => form.requestSubmit());

  await expect(page.locator('#signupStatus')).toContainText('通信状態を確認');
  await expect(page.locator('#signupButton')).toBeEnabled();

  let signUpCalls = await page.evaluate(
    () =>
      globalThis.__NOVELIGHT_AUTH_E2E_CALLS__.filter(
        (call) => call.type === 'signUp'
      ).length
  );
  expect(signUpCalls).toBe(1);

  await page.locator('#signupButton').click();
  await expect(page.locator('#signupStatus')).toContainText(
    '会員登録に失敗しました。入力内容を確認してください。'
  );
  await expect(page.locator('#signupButton')).toBeEnabled();

  signUpCalls = await page.evaluate(
    () =>
      globalThis.__NOVELIGHT_AUTH_E2E_CALLS__.filter(
        (call) => call.type === 'signUp'
      ).length
  );
  expect(signUpCalls).toBe(2);
  expect(pageErrors).toEqual([]);
});

test('successful session signup survives rejected optional telemetry', async ({
  page
}) => {
  await installAuthResilienceStubs(page, {
    signupSession: { user: { id: 'author-e2e' } },
    claimReject: 'claim unavailable',
    visitReject: 'visit unavailable'
  });
  const pageErrors = collectPageErrors(page);

  await page.goto('/signup.html');
  await fillSignup(page);
  await page.locator('#signupButton').click();

  await expect(page.locator('#signupStatus')).toContainText(
    '登録確認メールを送信しました。'
  );
  await expect(page.locator('#signupButton')).toBeEnabled();
  expect(pageErrors).toEqual([]);
});

test('forgot-password rejection restores retry while keeping enumeration-safe copy', async ({
  page
}) => {
  await installAuthResilienceStubs(page, {
    resetPasswordReject: 'temporary recovery network failure'
  });
  const pageErrors = collectPageErrors(page);

  await page.goto('/forgot-password.html');
  await page.locator('#email').fill('unknown@example.com');
  await page.locator('#button').click();

  await expect(page.locator('#status')).toHaveText(
    '入力されたメールアドレスが登録済みの場合、パスワード再設定メールが届きます。届かない場合は時間をおいて再度お試しください。'
  );
  await expect(page.locator('#button')).toBeEnabled();
  expect(pageErrors).toEqual([]);
});

test('reset-password leaves the pending state when getSession rejects', async ({
  page
}) => {
  await installAuthResilienceStubs(page, {
    getSessionReject: 'temporary session lookup failure'
  });
  const pageErrors = collectPageErrors(page);

  await page.goto('/reset-password.html');

  await expect(page.locator('#status')).toContainText(
    '再設定リンクを確認できませんでした。'
  );
  await expect(page.locator('#status')).not.toContainText(
    '再設定リンクを確認しています...'
  );
  await expect(page.locator('#button')).toBeDisabled();
  expect(pageErrors).toEqual([]);
});

test('reset-password update rejection restores the submit button for retry', async ({
  page
}) => {
  await installAuthResilienceStubs(page, {
    session: { user: { id: 'reader-e2e' } },
    authDelayMs: 80,
    updateUserRejectTimes: 1,
    updateUserError: 'expired recovery'
  });
  const pageErrors = collectPageErrors(page);

  await page.goto('/reset-password.html');
  await expect(page.locator('#button')).toBeEnabled();
  await page.locator('#password').fill('newpassword123');
  await page.locator('#confirm').fill('newpassword123');
  await page.locator('#button').click();

  await expect(page.locator('#status')).toContainText('通信状態を確認');
  await expect(page.locator('#button')).toBeEnabled();

  await page.locator('#button').click();
  await expect(page.locator('#status')).toContainText(
    'リンクの期限を確認し、再度お試しください。'
  );
  await expect(page.locator('#button')).toBeEnabled();

  const updateCalls = await page.evaluate(
    () =>
      globalThis.__NOVELIGHT_AUTH_E2E_CALLS__.filter(
        (call) => call.type === 'updateUser'
      ).length
  );
  expect(updateCalls).toBe(2);
  expect(pageErrors).toEqual([]);
});

test('reset-password success and login redirect survive local signOut rejection', async ({
  page
}) => {
  await installAuthResilienceStubs(page, {
    session: { user: { id: 'reader-e2e' } },
    signOutReject: 'local storage unavailable'
  });
  await page.route('**/login.html', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>login redirect</title>'
    });
  });
  const pageErrors = collectPageErrors(page);

  await page.goto('/reset-password.html');
  await expect(page.locator('#button')).toBeEnabled();
  await page.locator('#password').fill('newpassword123');
  await page.locator('#confirm').fill('newpassword123');
  await page.locator('#button').click();

  await expect(page.locator('#status')).toHaveText(
    'パスワードを変更しました。新しいパスワードでログインしてください。'
  );
  await expect(page).toHaveURL(/\/login\.html$/);
  expect(pageErrors).toEqual([]);
});
