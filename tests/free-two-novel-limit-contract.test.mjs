import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const [
  migration,
  precheck,
  postcheck,
  rollback,
  rlsRunner
] = await Promise.all([
  read('supabase/migrations/20260920152733_free_two_novel_limit.sql'),
  read('supabase/checks/20260920152733_free_two_novel_limit_precheck.sql'),
  read('supabase/checks/20260920152733_free_two_novel_limit_postcheck.sql'),
  read('supabase/rollback/20260920152733_free_two_novel_limit_rollback.sql'),
  read('scripts/run-rls-integration.sh')
]);

test('September two-work migration is retained as an immutable historical change', () => {
  assert.match(migration, /when 'free' then 2/u);
  assert.match(rollback, /when 'free' then 1/u);
});
test('database rule raises only Free while preserving concurrency enforcement', () => {
  assert.match(migration, /when 'free' then 2/u);
  assert.match(migration, /when 'standard' then 10/u);
  assert.match(migration, /when 'premium' then 30/u);
  assert.match(migration, /for update;/u);
  assert.match(migration, /current_count >= max_novels/u);
  assert.match(migration, /from public, anon, authenticated;/u);

  assert.match(precheck, /1\/10\/30/u);
  assert.match(postcheck, /2\/10\/30/u);
  assert.match(rollback, /when 'free' then 1/u);

  for (const path of [
    'supabase/checks/20260920152733_free_two_novel_limit_precheck.sql',
    'supabase/migrations/20260920152733_free_two_novel_limit.sql',
    'supabase/checks/20260920152733_free_two_novel_limit_postcheck.sql',
    'supabase/rollback/20260920152733_free_two_novel_limit_rollback.sql'
  ]) {
    assert.match(rlsRunner, new RegExp(path.replaceAll('/', '\\/')));
  }
});
