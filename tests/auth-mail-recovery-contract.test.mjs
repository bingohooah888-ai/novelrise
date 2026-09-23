import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const forgot = await readFile('forgot-password.html', 'utf8');
const reset = await readFile('reset-password.html', 'utf8');
const signup = await readFile('signup.html', 'utf8');
const account = await readFile('account-settings.html', 'utf8');

test('password recovery is email-enumeration neutral and locally throttled', () => {
  assert.match(forgot, /auth\.resetPasswordForEmail\(email,\{redirectTo\}\)/u);
  assert.match(forgot, /new URL\('reset-password\.html',location\.href\)/u);
  assert.match(forgot, /登録済みのメールアドレスであれば/u);
  assert.match(forgot, /let remaining=60/u);
  assert.match(forgot, /if\(button\.disabled\)return/u);
  assert.doesNotMatch(forgot, /メールアドレスは登録されていません/u);
  assert.doesNotMatch(forgot, /β期間中はメール配信基盤/u);
});

test('password reset accepts only a recovery link and globally closes sessions', () => {
  assert.match(reset, /event==='PASSWORD_RECOVERY'/u);
  assert.match(
    reset,
    /event==='PASSWORD_RECOVERY'&&session\)\{recoveryReady=true/u
  );
  assert.doesNotMatch(reset, /getSession\(\)/u);
  assert.doesNotMatch(reset, /type'\)==='recovery'/u);
  assert.match(reset, /auth\.updateUser\(\{password\}\)/u);
  assert.match(reset, /auth\.signOut\(\{scope:'global'\}\)/u);
  assert.match(reset, /auth\.signOut\(\{scope:'local'\}\)/u);
});

test('signup waits for inbox confirmation instead of requiring autoconfirm', () => {
  assert.match(signup, /emailRedirectTo/u);
  assert.match(signup, /if\(!data\?\.session\)/u);
  assert.match(signup, /確認メールを送信しました/u);
  assert.doesNotMatch(signup, /β版の認証設定を確認中/u);
});

test('email change is authenticated and preserves Secure Email Change UX', () => {
  assert.match(account, /client\.auth\.getUser\(\)/u);
  assert.match(
    account,
    /client\.auth\.updateUser\(\{email:newEmail\},\{emailRedirectTo\}\)/u
  );
  assert.match(account, /現在のメールアドレスと新しいメールアドレスの両方/u);
  assert.match(account, /Auth user IDへ紐付く/u);
  assert.match(account, /現在とは異なるメールアドレス/u);
  assert.match(account, /newEmailEl\.disabled=true/u);
  assert.doesNotMatch(account, /メールアドレス変更を一時停止/u);
});
