import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const id = '20261013030000_free_five_novel_limit';

const home = await read('index.html');
const pricing = await read('pricing.html');
const billing = await read('billing-policy.html');
const master = await read('docs/NOVELIGHT-MASTER.md');
const migration = await read(`supabase/migrations/${id}.sql`);
const precheck = await read(`supabase/checks/${id}_precheck.sql`);
const postcheck = await read(`supabase/checks/${id}_postcheck.sql`);
const rollback = await read(`supabase/rollback/${id}_rollback.sql`);
const runner = await read('scripts/run-rls-integration.sh');
const rls = await read('tests/rls/billing-and-plan-limits.sql');

test('Free plan surfaces and MASTER allow five works', () => {
  assert.match(home, /5作品まで投稿/u);
  assert.match(pricing, /投稿作品：5作品まで/u);
  assert.match(billing, /月額0円。投稿5作品まで。/u);
  assert.match(master, /Free 5作品、Standard 10作品、Premium 30作品/u);
});

test('DB trigger raises only the Free cap and retains its security gates', () => {
  assert.match(precheck, /when ''free'' then 2/u);
  assert.match(postcheck, /when ''free'' then 5/u);
  assert.match(rollback, /when 'free' then 2/u);
  assert.match(migration, /when 'free' then 5/u);
  assert.match(migration, /when 'standard' then 10/u);
  assert.match(migration, /when 'premium' then 30/u);
  assert.match(migration, /for update;/u);
  assert.match(migration, /auth\.uid\(\)/u);
  assert.match(migration, /current_count >= max_novels/u);
  assert.match(migration, /revoke all on function/u);
  assert.match(precheck, /trigger_count <> 1/u);
  assert.match(postcheck, /trigger_count <> 1/u);
});

test('RLS runner covers migration, verification, and rollback', () => {
  assert.ok(runner.includes(`supabase/checks/${id}_precheck.sql`));
  assert.ok(runner.includes(`supabase/migrations/${id}.sql`));
  assert.ok(runner.includes(`supabase/checks/${id}_postcheck.sql`));
  assert.ok(runner.includes(`supabase/rollback/${id}_rollback.sql`));
  assert.match(rls, /first five novels succeed, sixth is rejected/u);
  assert.match(rls, /free user must remain capped at five novels/u);
});
