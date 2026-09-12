import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { join } from 'node:path';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const signup = await readFile(join(root.pathname, 'signup.html'), 'utf8');

test('signup is fail-closed until the beta campaign state is known', () => {
  assert.match(signup, /<form id="signupForm" hidden>/);
  assert.match(signup, /id="signupButton" type="submit" disabled/);
  assert.match(signup, /let signupEnabled=false;/);
  assert.match(signup, /void loadSignupGate\(\);/);
  assert.match(signup, /if\(!signupEnabled\)/);
});

test('signup reuses the preregistration campaign state as the launch gate', () => {
  assert.match(signup, /fetch\('\/api\/beta-author-preregistration'/);
  assert.match(signup, /cache:'no-store'/);
  assert.match(signup, /state==='PRE_REGISTRATION'/);
  assert.match(signup, /state==='BETA_OPEN'\|\|state==='CLOSED'/);
  assert.match(signup, /showPreregistrationGate\(\)/);
  assert.match(signup, /showSignupForm\(\)/);
});

test('preregistration state routes users to the isolated beta author LP', () => {
  assert.match(signup, /id="preregistrationLink" href="beta-authors" hidden/);
  assert.match(signup, /現在は先行作者登録期間です/);
  assert.match(signup, /β版の一般会員登録はまだ開始していません/);
});

test('campaign lookup failures keep normal signup closed', () => {
  assert.match(signup, /if\(!response\.ok\)throw new Error\('campaign unavailable'\)/);
  assert.match(signup, /throw new Error\('unexpected campaign state'\)/);
  assert.match(signup, /catch\(error\).*showUnavailableGate\(\)/s);
  assert.match(signup, /安全のため、現在は新規会員登録を停止しています/);
});

test('existing signup metadata and auth flow remain intact behind the gate', () => {
  assert.match(signup, /client\.auth\.signUp/);
  assert.match(signup, /data:\{display_name:name\}/);
  assert.match(signup, /emailRedirectTo:window\.location\.origin\+'\/index\.html'/);
});
