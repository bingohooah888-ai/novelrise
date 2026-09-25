import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const fixturePath = process.env.PRODUCTION_AUTH_SMOKE_FIXTURE;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const publishableKey = 'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE';

if (!fixturePath) {
  throw new Error('PRODUCTION_AUTH_SMOKE_FIXTURE is required.');
}
if (!supabaseUrl || !supabaseSecretKey) {
  throw new Error('Production Supabase credentials are required.');
}

const authOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  }
};

function loadFixture() {
  return JSON.parse(readFileSync(fixturePath, 'utf8'));
}

function adminClient() {
  return createClient(supabaseUrl, supabaseSecretKey, authOptions);
}

function publicClient() {
  return createClient(supabaseUrl, publishableKey, authOptions);
}

function requireSuccess(result, label) {
  expect(result.error, `${label}: ${result.error?.message || ''}`).toBeNull();
  return result.data;
}

async function login(page, account) {
  await page.goto('/login.html?redirect=mypage.html');
  await page.locator('#email').fill(account.email);
  await page.locator('#password').fill(account.password);
  await page.locator('#loginButton').click();
  await page.waitForURL((url) => url.pathname.endsWith('/mypage.html'));
  await expect(
    page.getByRole('heading', { name: /さんの創作室$/ })
  ).toBeVisible();
}

function assertSafeActionLink(actionLink, expectedType) {
  const url = new globalThis.URL(actionLink);
  expect(url.origin).toBe(supabaseUrl);
  expect(url.pathname).toBe('/auth/v1/verify');
  expect(url.searchParams.get('type')).toBe(expectedType);
  expect(url.searchParams.get('redirect_to')).toBe(
    'https://novelrise.vercel.app/reset-password.html'
  );
  return actionLink;
}

test('Production signup gate, recovery, global sign-out, and Secure Email Change work', async ({
  browser,
  page
}) => {
  const fixture = loadFixture();
  const recovery = fixture.mail?.recovery;
  const emailChange = fixture.mail?.emailChange;
  if (!recovery || !emailChange) {
    throw new Error('Missing isolated Production Auth/Mail smoke identities.');
  }

  const admin = adminClient();

  await test.step('Current PRE_REGISTRATION gate rejects ordinary signup', async () => {
    const email = `novelight-e2e-blocked-signup-${fixture.runId}-${randomBytes(4).toString('hex')}@example.com`;
    const signup = await publicClient().auth.signUp({
      email,
      password: `Nl!Blocked-${fixture.runId}-9a`
    });
    expect(signup.data.session).toBeNull();
    expect(signup.error).toBeTruthy();
    expect(String(signup.error?.message || '')).toMatch(
      /先行作者登録期間|一般会員登録/u
    );
  });

  await test.step('Password recovery request uses the neutral Production UI', async () => {
    const recoveryResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/auth/v1/recover') &&
        response.request().method() === 'POST'
    );
    await page.goto('/forgot-password.html');
    await page.locator('#email').fill(recovery.email);
    await page.locator('#button').click();
    expect((await recoveryResponse).ok()).toBeTruthy();
    await expect(page.locator('#status')).toContainText(
      '登録済みのメールアドレスであれば'
    );
    await expect(page.locator('#button')).toBeDisabled();
  });

  const secondary = publicClient();
  const secondarySession = requireSuccess(
    await secondary.auth.signInWithPassword({
      email: recovery.email,
      password: recovery.password
    }),
    'create secondary recovery session'
  ).session;
  expect(secondarySession?.refresh_token).toBeTruthy();

  const recoveryLink = requireSuccess(
    await admin.auth.admin.generateLink({
      type: 'recovery',
      email: recovery.email,
      options: {
        redirectTo: 'https://novelrise.vercel.app/reset-password.html'
      }
    }),
    'generate recovery verification link'
  ).properties.action_link;
  assertSafeActionLink(recoveryLink, 'recovery');

  const newPassword = `Nl!Reset-${fixture.runId}-${randomBytes(6).toString('hex')}9a`;
  await test.step('Recovery link resets the password and globally signs out', async () => {
    await page.goto(recoveryLink);
    await page.waitForURL((url) =>
      url.pathname.endsWith('/reset-password.html')
    );
    await expect(page.locator('#button')).toBeEnabled();
    await page.locator('#password').fill(newPassword);
    await page.locator('#confirm').fill(newPassword);
    await page.locator('#button').click();
    await expect(page.locator('#status')).toContainText(
      'すべてのセッションを終了しました'
    );
    await page.waitForURL((url) => url.pathname.endsWith('/login.html'));

    const revoked = await secondary.auth.refreshSession({
      refresh_token: secondarySession.refresh_token
    });
    expect(revoked.data.session).toBeNull();
    expect(revoked.error).toBeTruthy();

    const oldPassword = await publicClient().auth.signInWithPassword({
      email: recovery.email,
      password: recovery.password
    });
    expect(oldPassword.data.session).toBeNull();
    expect(oldPassword.error).toBeTruthy();

    const newPasswordClient = publicClient();
    const newPasswordLogin = await newPasswordClient.auth.signInWithPassword({
      email: recovery.email,
      password: newPassword
    });
    expect(newPasswordLogin.error).toBeNull();
    expect(newPasswordLogin.data.user?.id).toBe(recovery.id);
    await newPasswordClient.auth.signOut({ scope: 'local' });
  });

  await test.step('Recovery fixture is removed before reusing the delivered test mailbox', async () => {
    requireSuccess(
      await admin.auth.admin.deleteUser(recovery.id),
      'delete completed recovery user'
    );
    const deleted = await admin.auth.admin.getUserById(recovery.id);
    expect(deleted.data.user).toBeNull();
    expect(deleted.error).toBeTruthy();
  });

  const changedEmail = 'delivered@resend.dev';
  await test.step('Logged-in user starts Secure Email Change', async () => {
    await login(page, emailChange);
    await page.goto('/account-settings.html');
    await expect(page.locator('#currentEmail')).toHaveText(emailChange.email);
    const updateResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/auth/v1/user') &&
        response.request().method() !== 'GET'
    );
    await page.locator('#newEmail').fill(changedEmail);
    await page.locator('#emailButton').click();
    expect((await updateResponse).ok()).toBeTruthy();
    await expect(page.locator('#pendingEmailNotice')).toBeVisible();
    await expect(page.locator('#status')).toContainText(
      '両方のメールアドレスへ届く確認リンク'
    );

    const pending = requireSuccess(
      await admin.auth.admin.getUserById(emailChange.id),
      'read pending email change user'
    ).user;
    expect(pending.id).toBe(emailChange.id);
    expect(pending.email).toBe(emailChange.email);
    expect(pending.new_email).toBe(changedEmail);
  });

  const currentLink = requireSuccess(
    await admin.auth.admin.generateLink({
      type: 'email_change_current',
      email: emailChange.email,
      newEmail: changedEmail,
      options: { redirectTo: 'https://novelrise.vercel.app/index.html' }
    }),
    'generate current-email confirmation link'
  ).properties.action_link;
  const newLink = requireSuccess(
    await admin.auth.admin.generateLink({
      type: 'email_change_new',
      email: emailChange.email,
      newEmail: changedEmail,
      options: { redirectTo: 'https://novelrise.vercel.app/index.html' }
    }),
    'generate new-email confirmation link'
  ).properties.action_link;

  await test.step('Both Secure Email Change confirmations preserve ownership', async () => {
    for (const actionLink of [currentLink, newLink]) {
      const actionUrl = new globalThis.URL(actionLink);
      expect(actionUrl.origin).toBe(supabaseUrl);
      expect(actionUrl.pathname).toBe('/auth/v1/verify');
      expect(actionUrl.searchParams.get('type')).toMatch(/^email_change/u);
      const context = await browser.newContext();
      try {
        const confirmationPage = await context.newPage();
        await confirmationPage.goto(actionLink);
        await confirmationPage.waitForURL((url) =>
          url.pathname.endsWith('/index.html')
        );
      } finally {
        await context.close();
      }
    }

    const changed = requireSuccess(
      await admin.auth.admin.getUserById(emailChange.id),
      'read changed email user'
    ).user;
    expect(changed.id).toBe(emailChange.id);
    expect(changed.email).toBe(changedEmail);

    const profile = requireSuccess(
      await admin
        .from('profiles')
        .select('id')
        .eq('id', emailChange.id)
        .single(),
      'read profile after email change'
    );
    expect(profile.id).toBe(emailChange.id);

    const changedLogin = await publicClient().auth.signInWithPassword({
      email: changedEmail,
      password: emailChange.password
    });
    expect(changedLogin.error).toBeNull();
    expect(changedLogin.data.user?.id).toBe(emailChange.id);

    const oldEmailLogin = await publicClient().auth.signInWithPassword({
      email: emailChange.email,
      password: emailChange.password
    });
    expect(oldEmailLogin.data.session).toBeNull();
    expect(oldEmailLogin.error).toBeTruthy();
  });
});
