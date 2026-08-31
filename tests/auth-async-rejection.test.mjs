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
  assert.doesNotMatch(
    login,
    /await runOptionalTelemetry\('post-login acquisition telemetry failed'/
  );
  assert.doesNotMatch(
    login,
    /await runOptionalTelemetry\('post-login visit telemetry failed'/
  );
  const authenticatedIndex = login.indexOf('authenticated=true;');
  const redirectTargetIndex = login.indexOf(
    'const redirectTarget=safeRedirectTarget(redirect);'
  );
  const acquisitionIndex = login.indexOf(
    "void runOptionalTelemetry('post-login acquisition telemetry failed'"
  );
  const visitIndex = login.indexOf(
    "void runOptionalTelemetry('post-login visit telemetry failed'"
  );
  const navigationIndex = login.indexOf('window.location.href=redirectTarget;');
  assert.ok(authenticatedIndex >= 0);
  assert.ok(redirectTargetIndex > authenticatedIndex);
  assert.ok(acquisitionIndex > redirectTargetIndex);
  assert.ok(visitIndex > acquisitionIndex);
  assert.ok(navigationIndex > visitIndex);
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
  assert.match(signup, /finally\{button\.disabled=false\}/);
  assert.match(signup, /async function runOptionalTelemetry/);
  assert.match(signup, /post-signup acquisition telemetry failed/);
  assert.match(signup, /会員登録に失敗しました。入力内容を確認してください。/);
});

test('forgot-password keeps enumeration-safe recovery copy', () => {
  assert.match(forgotPassword, /if\(button\.disabled\)return/);
  assert.match(
    forgotPassword,
    /try\{const \{error\}=await client\.auth\.resetPasswordForEmail/
  );
  assert.match(
    forgotPassword,
    /catch\(error\)\{console\.error\('password reset request failed'/
  );
  assert.match(forgotPassword, /finally\{/);
  assert.match(
    forgotPassword,
    /入力されたメールアドレスが登録済みの場合、パスワード再設定メールが届きます。届かない場合は時間をおいて再度お試しください。/
  );
  assert.match(forgotPassword, /button\.disabled=false/);
});

test('reset-password catches async failures and isolates sign-out', () => {
  assert.match(
    resetPassword,
    /async function checkRecovery\(\)\{try\{const \{data,error\}=await client\.auth\.getSession/
  );
  assert.match(resetPassword, /password recovery session check failed/);
  assert.match(
    resetPassword,
    /再設定リンクを確認できませんでした。通信状態を確認し、ページを再読み込みしてお試しください。/
  );
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
  assert.match(
    resetPassword,
    /if\(signOutError\)console\.error\('local sign out failed'/
  );
  assert.match(
    resetPassword,
    /catch\(error\)\{console\.error\('local sign out failed'/
  );
  assert.match(
    resetPassword,
    /変更できませんでした。リンクの期限を確認し、再度お試しください。/
  );

  const successIndex = resetPassword.indexOf(
    "status.textContent='パスワードを変更しました。新しいパスワードでログインしてください。'"
  );
  const signOutIndex = resetPassword.indexOf(
    "await client.auth.signOut({scope:'local'})"
  );
  const redirectIndex = resetPassword.indexOf(
    "setTimeout(()=>{window.location.href='login.html'},600)"
  );
  assert.ok(successIndex >= 0 && signOutIndex > successIndex);
  assert.ok(redirectIndex > successIndex);
  assert.match(
    resetPassword,
    /void \(async\(\)=>\{try\{const \{error:signOutError\}=await client\.auth\.signOut/
  );
});
