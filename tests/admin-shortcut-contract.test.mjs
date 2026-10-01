import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const shortcutRuntime = readFileSync(
  new URL('../novelight-scout-title-toast.js', import.meta.url),
  'utf8'
);
const adminAccessApi = readFileSync(
  new URL('../api/admin-access.js', import.meta.url),
  'utf8'
);

test('admin shortcut is gated by the server-side admin access endpoint', () => {
  assert.match(shortcutRuntime, /fetch\('\/api\/admin-access'/);
  assert.match(
    shortcutRuntime,
    /Authorization: 'Bearer ' \+ session\.access_token/
  );
  assert.match(shortcutRuntime, /if \(!payload\?\.admin\) return false/);
  assert.match(shortcutRuntime, /page\.startsWith\('admin'\)/);
});

test('admin shortcut supports desktop and mobile shared headers', () => {
  assert.match(shortcutRuntime, /novelight-admin-shortcut-desktop/);
  assert.match(shortcutRuntime, /details\.mobile-menu nav/);
  assert.match(shortcutRuntime, /管理画面/);
});

test('admin access endpoint delegates authorization to requireAdmin', () => {
  assert.match(adminAccessApi, /requireAdmin/);
  assert.match(adminAccessApi, /admin: true/);
  assert.doesNotMatch(adminAccessApi, /email\s*===/);
});
