import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const clientScript = await readFile(
  new URL('../novelight-client.js', import.meta.url),
  'utf8'
);

test('shared client syncs homepage login link with Supabase session', () => {
  assert.match(clientScript, /async function syncAuthHeader\(client\)/);
  assert.match(clientScript, /client\.auth\.getSession\(\)/);
  assert.match(clientScript, /loginLink\.textContent = '作者ホーム'/);
  assert.match(clientScript, /loginLink\.href = 'mypage\.html'/);
  assert.match(clientScript, /loginLink\.textContent = 'ログイン'/);
  assert.match(clientScript, /loginLink\.href = 'login\.html'/);
  assert.match(clientScript, /await syncAuthHeader\(client\)/);
});
