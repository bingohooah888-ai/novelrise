import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath =
  'supabase/migrations/20260909140000_chapter38_seed_discovery_exp.sql';
const rollbackPath =
  'supabase/rollback/20260909140000_chapter38_seed_discovery_exp_rollback.sql';
const foundationPath =
  'supabase/migrations/20260909071500_scout_beta_event_foundations.sql';

test('Chapter 38 discovery rules and provenance remain explicit', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  for (const token of [
    'then 80',
    'then 150',
    'then 300',
    'then 600',
    'then 1000',
    "when 'GOLD' then 2.0",
    "when 'SILVER' then 1.5",
    "interval '180 days'",
    "'rank_event_id'",
    "'delta_xp'"
  ])
    assert.match(sql, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('send-time Rank is captured by the existing Chapter 38 foundation', async () => {
  const sql = await readFile(foundationPath, 'utf8');
  assert.match(sql, /create trigger light_seeds_snapshot_rank/);
  assert.match(sql, /new\.rank_at_seed := v_rank/);
  assert.match(
    sql,
    /new\.rank_code_at_seed := public\.novelight_rank_code\(v_rank\)/
  );
});

test('discovery processing is server-only and replay-safe', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /for update/);
  assert.match(sql, /on conflict \(event_key\) do nothing/);
  assert.match(sql, /revoke all on function[\s\S]*public, anon, authenticated/);
  assert.match(sql, /grant execute[\s\S]*service_role/);
});

test('rollback preserves replay evidence', async () => {
  const sql = await readFile(rollbackPath, 'utf8');
  assert.doesNotMatch(sql, /drop table|delete from|truncate/i);
  assert.match(sql, /drop trigger/);
});
