import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/20260930193000_episode_illustration_logical_delete.sql',
  'utf8'
);
const api = readFileSync('api/_lib/episode-illustrations.js', 'utf8');
const ui = readFileSync('novelight-episode-illustrations.js', 'utf8');

test('episode illustration delete uses a revision-safe logical delete contract', () => {
  assert.match(migration, /add column if not exists deleted_at timestamptz/);
  assert.match(migration, /novelight_delete_episode_illustration/);
  assert.match(migration, /EPISODE_ILLUSTRATION_IN_USE/);
  assert.match(migration, /i\.deleted_at is null[\s\S]*marker_line/);
  assert.match(
    migration,
    /grant execute on function public\.novelight_delete_episode_illustration[\s\S]*to service_role/
  );
});

test('API exposes delete without removing storage objects', () => {
  assert.match(api, /action === 'delete'/);
  assert.match(api, /novelight_delete_episode_illustration/);
  assert.match(api, /status: 409,[\s\S]*EPISODE_ILLUSTRATION_IN_USE/);
  const start = api.indexOf('async function deleteIllustration');
  const end = api.indexOf('function referencedIds', start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(api.slice(start, end), /storage[\s\S]*\.remove\(/);
});

test('editor only enables deletion for locally unused illustrations', () => {
  assert.match(ui, /deleteButton\.textContent = '削除'/);
  assert.match(ui, /deleteButton\.disabled = busy \|\| isUsed/);
  assert.match(ui, /action: 'delete'/);
  assert.match(ui, /10枚上限の枠が1つ戻りました/);
  assert.match(ui, /先に本文から外して保存してください/);
});
