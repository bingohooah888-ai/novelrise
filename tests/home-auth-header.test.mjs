import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const clientScript = await readFile('novelight-client.js', 'utf8');

test('shared client syncs desktop and mobile login links with Supabase session', () => {
  assert.match(clientScript, /async function syncAuthHeader\(client\)/);
  assert.match(clientScript, /client\.auth\.getSession\(\)/);
  assert.match(clientScript, /querySelectorAll\('a\[href="login\.html"\]'\)/);
  assert.match(clientScript, /loginLinks\.forEach\(\(loginLink\) =>/);
  assert.match(clientScript, /loginLink\.textContent = '創作室'/);
  assert.match(clientScript, /loginLink\.href = 'mypage\.html'/);
  assert.match(clientScript, /loginLink\.textContent = 'ログイン'/);
  assert.match(clientScript, /loginLink\.href = 'login\.html'/);
  assert.match(clientScript, /void syncAuthHeader\(client\)/);
});
