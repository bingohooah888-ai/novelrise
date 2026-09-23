import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const login = await readFile('login.html', 'utf8');
const signup = await readFile('signup.html', 'utf8');
const forgotPassword = await readFile('forgot-password.html', 'utf8');
const resetPassword = await readFile('reset-password.html', 'utf8');

test('login catches auth rejections and isolates telemetry', () => {
  assert.match(login, /if\(button\.disabled\)return/);
  assert.match(
    login,
    /const \{error\}=await supabaseClient\.auth\.signInWithPassword/
  );
  assert.match(
    login,
    /catch\(error\)\{\s*console\.error\('login request failed'/
  );
  assert.match(login, /finally\{\s*if\(!authenticated\)button\.disabled=false/);
  assert.match(login, /async function runOptionalTelemetry/);
  assert.match(login, /post-login acquisition telemetry failed/);
  const authSuccessIndex = login.indexOf('authenticated=true;');
  const acquisitionTelemetryIndex = login.indexOf(
    "void runOptionalTelemetry('post-login acquisition telemetry failed'"
  );
  const visitTelemetryIndex = login.indexOf(
    "void runOptionalTelemetry('post-login visit telemetry failed'"
  );
  const redirectIndex = login.indexOf('window.location.href=redirectTarget;');
  assert.ok(authSuccessIndex >= 0);
  assert.ok(acquisitionTelemetryIndex > authSuccessIndex);
  assert.ok(visitTelemetryIndex > authSuccessIndex);
  assert.ok(redirectIndex > acquisitionTelemetryIndex);
  assert.ok(redirectIndex > visitTelemetryIndex);
  assert.doesNotMatch(login, /await runOptionalTelemetry\('post-login/);
  assert.match(
    login,
    /ログインできませんでした。メールアドレスとパスワードを確認してください。/
  );
});

test('signup catches auth rejections and restores retry', () => {
  assert.match(signup, /if\(button\.disabled\)return/);
  assert.match(signup, /const \{data,error\}=await client\.auth\.signUp/);
  assert.match(
    signup,
    /catch\(error\)\{console\.error\('signup request failed'/
  );
  assert.match(signup, /finally\{if\(!completed\)button\.disabled=false\}/);
  assert.match(signup, /async function runOptionalTelemetry/);
  assert.match(signup, /post-signup acquisition telemetry failed/);
  assert.match(
    signup,
    /会員登録を受け付けられませんでした。通信状態を確認し、時間をおいて再度お試しください。/
  );
});

test('forgot-password catches mail failures without account enumeration', () => {
  assert.match(
    forgotPassword,
    /auth\.resetPasswordForEmail\(email,\{redirectTo\}\)/
  );
  assert.match(forgotPassword, /登録済みのメールアドレスであれば/);
  assert.match(forgotPassword, /if\(button\.disabled\)return/);
  assert.match(
    forgotPassword,
    /catch\(error\)\{console\.error\('password recovery request failed'/
  );
  assert.doesNotMatch(forgotPassword, /メールアドレスは登録されていません/);
});

test('reset-password catches async failures and isolates sign-out', () => {
  assert.match(resetPassword, /event==='PASSWORD_RECOVERY'&&session/);
  assert.doesNotMatch(resetPassword, /auth\.getSession\(\)/);
  assert.match(resetPassword, /rejectMissingRecoveryEvent/);
  assert.match(resetPassword, /if\(!recoveryReady\|\|button\.disabled\)return/);
  assert.match(resetPassword, /const \{error\}=await client\.auth\.updateUser/);
  assert.match(
    resetPassword,
    /catch\(error\)\{console\.error\('password update failed'/
  );
  assert.match(
    resetPassword,
    /finally\{if\(!passwordUpdated\)button\.disabled=false\}/
  );
  assert.match(
    resetPassword,
    /const \{error:signOutError\}=await client\.auth\.signOut/
  );
  assert.match(resetPassword, /auth\.signOut\(\{scope:'global'\}\)/);
  assert.match(resetPassword, /auth\.signOut\(\{scope:'local'\}\)/);
  assert.match(
    resetPassword,
    /変更できませんでした。リンクの期限を確認し、再度お試しください。/
  );

  const successIndex = resetPassword.indexOf(
    "status.textContent='パスワードを変更しました。すべてのセッションを終了しました。新しいパスワードでログインしてください。'"
  );
  const signOutIndex = resetPassword.indexOf(
    "await client.auth.signOut({scope:'global'})"
  );
  const redirectIndex = resetPassword.indexOf(
    "setTimeout(()=>{window.location.href='login.html'},800)"
  );
  assert.ok(signOutIndex >= 0 && successIndex > signOutIndex);
  assert.ok(redirectIndex > successIndex);
});
