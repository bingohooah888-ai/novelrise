import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const account = await readFile('account-settings.html', 'utf8');

test('account settings keeps destructive account deletion in a separate danger zone', () => {
  assert.match(account, /危険な操作/u);
  assert.match(account, /Premiumのプラン解約とは別の操作/u);
  assert.match(account, /id="openDeleteDialog"[\s\S]*?>アカウントを削除</u);
  assert.match(account, /id="deleteDialog"/u);
  assert.match(account, /この操作は取り消せません/u);
});

test('account deletion requires an exact typed confirmation before calling the server', () => {
  assert.match(account, /const DELETE_CONFIRMATION='アカウントを削除'/u);
  assert.match(
    account,
    /confirmDelete\.disabled=deleteConfirmation\.value!==DELETE_CONFIRMATION/u
  );
  assert.match(account, /fetch\('\/api\/delete-account'/u);
  assert.match(account, /confirmation:DELETE_CONFIRMATION/u);
  assert.match(account, /client\.auth\.refreshSession\(\)/u);
  assert.match(account, /client\.auth\.signOut\(\{scope:'local'\}\)/u);
});

test('service-role account deletion stays server-side', () => {
  assert.doesNotMatch(account, /SUPABASE_SECRET_KEY|service_role/u);
  assert.doesNotMatch(account, /auth\.admin|deleteUser\(/u);
});
