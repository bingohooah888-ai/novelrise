import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const signup = await readFile('signup.html', 'utf8');
const requiredMarkers = [
  "code==='weak_password'",
  "message.includes('failed to fetch')",
  'recoverSignupAfterNetworkFailure(email,password)',
  "recovery.kind==='session'",
  "recovery.kind==='confirmation'",
  'finishAuthenticatedSignup(pendingTarget)',
  'パスワードがセキュリティ条件を満たしていません。',
  '登録が完了している可能性があります。'
];

test('signup handles reported auth failure modes', () => {
  for (const marker of requiredMarkers) assert.ok(signup.includes(marker));
});
