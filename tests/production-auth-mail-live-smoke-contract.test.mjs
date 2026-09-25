import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const smoke = await readFile(
  'tests/e2e/production-auth/auth-mail-smoke.spec.js',
  'utf8'
);
const fixture = await readFile(
  'scripts/production-auth-smoke-fixture.mjs',
  'utf8'
);

test('Production Auth/Mail live smoke covers recovery and global sign-out', () => {
  assert.match(smoke, /auth\/v1\/recover/u);
  assert.match(smoke, /登録済みのメールアドレスであれば/u);
  assert.match(smoke, /type: 'recovery'/u);
  assert.match(smoke, /refreshSession/u);
  assert.match(smoke, /oldPassword\.data\.session/u);
  assert.match(smoke, /newPasswordLogin\.data\.user\?\.id/u);
  assert.match(smoke, /すべてのセッションを終了しました/u);
});

test('Production Auth/Mail live smoke proves Secure Email Change ownership continuity', () => {
  assert.match(smoke, /auth\.updateUser|auth\/v1\/user/u);
  assert.match(smoke, /両方のメールアドレスへ届く確認リンク/u);
  assert.match(smoke, /type: 'email_change_current'/u);
  assert.match(smoke, /type: 'email_change_new'/u);
  assert.match(smoke, /expect\(pending\.new_email\)\.toBe\(changedEmail\)/u);
  assert.match(smoke, /expect\(changed\.id\)\.toBe\(emailChange\.id\)/u);
  assert.match(smoke, /expect\(profile\.id\)\.toBe\(emailChange\.id\)/u);
  assert.match(smoke, /expect\(changed\.email\)\.toBe\(changedEmail\)/u);
  assert.match(smoke, /oldEmailLogin\.data\.session/u);
});

test('Production Auth/Mail live identities are isolated and included in cleanup', () => {
  assert.match(fixture, /mail: \{\}/u);
  assert.match(fixture, /fixture\.mail\.recovery = await createUser/u);
  assert.match(fixture, /fixture\.mail\.emailChange = await createUser/u);
  assert.match(
    fixture,
    /const mailIds = uniqueIds\(mailAccounts\(fixture\)\)/u
  );
  assert.match(fixture, /\.\.\.mailIds/u);
  assert.match(fixture, /admin\.auth\.admin\.deleteUser\(userId\)/u);
});
