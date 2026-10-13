import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const migrationId = '20261013030000_free_five_novel_limit';
const [home, pricing, billing, master, migration, precheck, postcheck, rollback, runner, rls] =
  await Promise.all([
    read('index.html'),
    read('pricing.html'),
    read('billing-policy.html'),
    read('docs/NOVELIGHT-MASTER.md'),
    read('supabase/migrations/' + migrationId + '.sql'),
    read('supabase/checks/' + migrationId + '_precheck.sql'),
    read('supabase/checks/' + migrationId + '_postcheck.sql'),
    read('supabase/rollback/' + migrationId + '_rollback.sql'),
    read('scripts/run-rls-integration.sh'),
    read('tests/rls/billing-and-plan-limits.sql')
  ]);

test('Free five-work cap is consistent across public billing pages and MASTER', () => {
  assert.match(home, /5作品まで投稿/u);
  assert.match(pricing, /投稿作品：5作品まで/u);
  assert.match(billing, /月額0円。投稿5作品まで。/u);
  assert.match(master, /投稿可能作品数は、Free 5作品、Standard 10作品、Premium 30作品/u);
  assert.doesNotMatch(pricing, /投稿作品：2作品まで/u);
  assert.doesNotMatch(billing, /月額0円。投稿2作品まで。/u);
});

test('new SQL migration raises only Free to 5 with existing owner, lock, and privilege guards', () => {
  assert.match(precheck, /when ''free'' then 2/u);
  assert.match(postcheck, /when ''free'' then 5/u);
  assert.match(rollback, /when 'free' then 2/u);
  assert.match(migration, /when 'free' then 5/u);
  for (const value of [10, 30]) {
    const plan = value === 10 ? 'standard' : 'premium';
    assert.match(migration, new RegExp("when '" + plan + "' then " + value));
    assert.match(rollback, new RegExp("when '" + plan + "' then " + value));
  }
  assert.match(migration, /for update;/u);
  assert.match(migration, /auth\.uid\(\)/u);
  assert.match(migration, /current_count >= max_novels/u);
  assert.match(migration, /revoke all on function/u);
  assert.match(precheck, /trigger_count <> 1/u);
  assert.match(postcheck, /trigger_count <> 1/u);
});

test('RLS integration replays migration, boundary test, and rollback', () => {
  for (const path of [
    'supabase/checks/' + migrationId + '_precheck.sql',
    'supabase/migrations/' + migrationId + '.sql',
    'supabase/checks/' + migrationId + '_postcheck.sql',
    'supabase/rollback/' + migrationId + '_rollback.sql'
  ]) assert.ok(runner.includes(path), 'missing RLS runner fixture: ' + path);
  assert.match(rls, /first five novels succeed, sixth is rejected/u);
  assert.match(rls, /free user must remain capped at five novels/u);
});
