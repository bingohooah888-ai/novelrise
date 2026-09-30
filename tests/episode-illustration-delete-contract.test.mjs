import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [browser, deleteApi] = await Promise.all([
  readFile('novelight-episode-illustrations.js', 'utf8'),
  readFile('api/episode-illustration-delete.js', 'utf8')
]);

test('editor exposes permanent delete only through the guarded delete API', () => {
  assert.match(
    browser,
    /const DELETE_API = '\/api\/episode-illustration-delete'/u
  );
  assert.match(browser, /remove\.textContent = '削除'/u);
  assert.match(browser, /global\.confirm/u);
  assert.match(browser, /EPISODE_ILLUSTRATION_IN_USE/u);
  assert.match(browser, /アップロード枠が1枚分戻りました/u);
  assert.match(browser, /本文から外す場合は挿絵IDの行を削除して保存/u);
});

test('delete API authenticates and rechecks episode edit access', () => {
  assert.match(deleteApi, /supabase\.auth\.getUser\(token\)/u);
  assert.match(deleteApi, /novelight_episode_illustration_editor_bundle/u);
  assert.match(deleteApi, /if \(!bundle\?\.can_edit\)/u);
  assert.match(deleteApi, /bundle\.assets/u);
  assert.match(deleteApi, /Illustration not found/u);
});

test('in-use illustrations are blocked before registry deletion', () => {
  const guard = deleteApi.indexOf('EPISODE_ILLUSTRATION_IN_USE');
  const deletion = deleteApi.indexOf(".from('episode_illustrations')");
  assert.ok(guard >= 0, 'in-use guard must exist');
  assert.ok(deletion > guard, 'in-use guard must run before registry deletion');
  assert.match(deleteApi, /markerUsed\(episode\.content, illustrationId\)/u);
  assert.match(deleteApi, /status\(409\)/u);
});

test('successful deletion frees the database slot before best-effort storage cleanup', () => {
  const registryDelete = deleteApi.indexOf(".from('episode_illustrations')");
  const storageDelete = deleteApi.indexOf('.from(BUCKET)');
  assert.ok(registryDelete >= 0, 'registry delete must exist');
  assert.ok(
    storageDelete > registryDelete,
    'storage cleanup must follow registry deletion'
  );
  assert.match(deleteApi, /\.delete\(\)/u);
  assert.match(deleteApi, /\.remove\(\[storagePath\]\)/u);
  assert.match(deleteApi, /storageCleanupPending/u);
});
