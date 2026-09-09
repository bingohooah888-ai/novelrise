import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath =
  'supabase/migrations/20260909190000_chapter38_star_rating_scout_exp.sql';
const precheckPath =
  'supabase/checks/20260909190000_chapter38_star_rating_scout_exp_precheck.sql';
const postcheckPath =
  'supabase/checks/20260909190000_chapter38_star_rating_scout_exp_postcheck.sql';
const rollbackPath =
  'supabase/rollback/20260909190000_chapter38_star_rating_scout_exp_rollback.sql';

test('Chapter 38 star-rating EXP keeps the MASTER reward and daily cap', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /'star_rating',[\s\S]*?3,[\s\S]*?'beta-v1'/);
  assert.match(
    sql,
    /pg_catalog\.timezone\('Asia\/Tokyo',[\s\S]*?occurred_at\)::date/
  );
  assert.match(sql, /daily_order <= 5/);
  assert.match(sql, /v_awarded_today < 5/);
});

test('only the first lifetime rating set can award EXP', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(
    sql,
    /partition by e\.user_id, e\.novel_id_snapshot[\s\S]*?lifetime_order/
  );
  assert.match(sql, /where lifetime_order = 1/);
  assert.match(sql, /e\.event_type = 'star_rating_set'/);
  assert.match(sql, /not v_had_lifetime_set/);
  assert.match(sql, /novelight:star-rating-xp:/);
});

test('rating changes and clears remain usable without extra EXP', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /v_event_type := 'star_rating_changed'/);
  assert.match(
    sql,
    /if v_event_type = 'star_rating_set' and not v_had_lifetime_set then/
  );
  assert.doesNotMatch(sql, /xp_kind[^;]*star_rating_changed/i);
});

test('precheck and postcheck fail closed around replay and privileges', async () => {
  const [precheck, postcheck] = await Promise.all([
    readFile(precheckPath, 'utf8'),
    readFile(postcheckPath, 'utf8'),
  ]);

  assert.match(
    precheck,
    /Existing star-rating SCOUT EXP requires manual reconciliation/
  );
  assert.match(
    postcheck,
    /authenticated must retain star-rating write access/
  );
  assert.match(postcheck, /Star-rating XP daily cap exceeded/);
  assert.match(
    postcheck,
    /Star-rating XP ledger does not match replayable beta rules/
  );
  assert.match(postcheck, /except select source_event_id from actual/);
  assert.match(postcheck, /except select source_event_id from expected/);
});

test('rollback removes only derived star EXP and preserves raw evidence', async () => {
  const sql = await readFile(rollbackPath, 'utf8');
  assert.match(sql, /delete from public\.scout_xp_ledger/);
  assert.match(sql, /x\.xp_kind = 'star_rating'/);
  assert.match(sql, /create or replace function public\.set_novel_star_rating/);
  assert.doesNotMatch(sql, /delete from public\.scout_event_ledger/i);
  assert.doesNotMatch(sql, /drop table|truncate/i);
});
