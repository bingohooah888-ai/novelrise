import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const signup = await readFile(join(root, 'signup.html'), 'utf8');
const expectSignup = (pattern) => assert.match(signup, pattern);

test('signup is fail-closed until the beta campaign state is known', () => {
  expectSignup(/<form id="signupForm" hidden>/);
  expectSignup(/id="signupButton" type="submit" disabled/);
  expectSignup(/let signupEnabled=false;/);
  expectSignup(/void loadSignupGate\(\);/);
  expectSignup(/if\(!signupEnabled\)/);
});

test('signup reuses the preregistration campaign state as the launch gate', () => {
  expectSignup(/fetch\('\/api\/beta-author-preregistration'/);
  expectSignup(/cache:'no-store'/);
  expectSignup(/state==='PRE_REGISTRATION'/);
  expectSignup(/state==='AUTHOR_PREOPEN'/);
  expectSignup(/state==='BETA_OPEN'\|\|state==='CLOSED'/);
  expectSignup(/showPreregistrationGate\(\)/);
  expectSignup(/showAuthorPreopen\(inviteValidated\)/);
  expectSignup(/showSignupForm\(\)/);
});

test('preregistration state routes users to the isolated beta author LP', () => {
  expectSignup(/id="preregistrationLink" href="beta-authors" hidden/);
  expectSignup(/現在は先行作者登録期間です/);
  expectSignup(/β版の一般会員登録はまだ開始していません/);
});

test('author preopen exposes signup only after secure invite validation', () => {
  expectSignup(/先行作者プレオープン中です/);
  expectSignup(/inviteValidated=await validateInvite\(\)/);
  expectSignup(/showAuthorPreopen\(inviteValidated\)/);
  expectSignup(/先行登録時のメールアドレスへお送りした専用の招待URL/);
  expectSignup(/招待URLを確認しました/);
});

test('campaign lookup failures keep normal signup closed', () => {
  expectSignup(/if\(!response\.ok\)throw new Error\('campaign unavailable'\)/);
  expectSignup(/throw new Error\('unexpected campaign state'\)/);
  expectSignup(/catch\(error\).*showUnavailableGate\(\)/s);
  expectSignup(/安全のため、現在は新規会員登録を停止しています/);
});

test('beta no-mail signup keeps profile metadata and requires an immediate session', () => {
  expectSignup(/client\.auth\.signUp/);
  expectSignup(/const signupMetadata=\{display_name:name\}/);
  expectSignup(/signupMetadata\.novelight_invite_token=inviteToken/);
  expectSignup(/if\(!data\?\.session\)/);
  expectSignup(/window\.location\.href='mypage\.html'/);
  assert.doesNotMatch(signup, /emailRedirectTo/u);
});
