import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('recommendation priority depends only on author plan', async () => {
  const sql = await read(
    '../supabase/migrations/20261012120000_plan_only_recommendations.sql'
  );
  assert.match(sql, /r\.free_weight/);
  assert.match(sql, /r\.standard_weight/);
  assert.match(sql, /r\.premium_weight/);
  assert.match(sql, /premium_plan_extra_weight/);
  assert.match(sql, /4503599627370496::numeric/);
  assert.match(sql, /novelight_is_general_discovery_eligible/);
  assert.match(sql, /premium_ranked/);
  assert.match(sql, /is_premium_slot/);
  assert.match(sql, /from weighted w/);
  assert.match(sql, /from scored s/);
});

test('home selection preserves weighted ordering and trusted receipts', async () => {
  const home = await read('../index.html');
  assert.match(home, /return unique\.slice\(0,limit\)/);
  assert.doesNotMatch(home, /authors\.has\(author\)/);
  assert.match(home, /if\(visible\.length\)void record\(visible\)/);
});

test('rollback restores previous ranking while retaining seed eligibility', async () => {
  const sql = await read(
    '../supabase/rollback/20261012120000_plan_only_recommendations_rollback.sql'
  );
  assert.match(sql, /normalized_author_exposure asc/);
  assert.match(sql, /premium_new_work_boost/);
  assert.doesNotMatch(sql, /create or replace function public\.novelight_is_light_seed_eligible/i);
});
