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

function has(text, token) {
  assert.equal(text.includes(token), true);
}

test('star-rating EXP keeps the MASTER reward and cap', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  has(sql, "'star_rating'");
  has(sql, "'beta-v1'");
  has(sql, "timezone('Asia/Tokyo'");
  has(sql, 'daily_order <= 5');
  has(sql, 'v_awarded_today < 5');
});

test('only the first lifetime rating can award EXP', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  has(sql, 'partition by e.user_id, e.novel_id_snapshot');
  has(sql, 'where lifetime_order = 1');
  has(sql, "e.event_type = 'star_rating_set'");
  has(sql, 'not v_had_lifetime_set');
  has(sql, 'novelight:star-rating-xp:');
});

test('rating changes stay usable without extra EXP', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  has(sql, "v_event_type := 'star_rating_changed'");
  has(sql, "v_event_type = 'star_rating_set'");
  has(sql, 'not v_had_lifetime_set');
  assert.equal(sql.includes("xp_kind = 'star_rating_changed'"), false);
});

test('checks enforce replay and privilege boundaries', async () => {
  const precheck = await readFile(precheckPath, 'utf8');
  const postcheck = await readFile(postcheckPath, 'utf8');
  has(precheck, 'Existing star-rating SCOUT EXP requires manual reconciliation');
  has(postcheck, 'authenticated must retain star-rating write access');
  has(postcheck, 'Star-rating XP daily cap exceeded');
  has(postcheck, 'Star-rating XP ledger does not match replayable beta rules');
  has(postcheck, 'except select source_event_id from actual');
  has(postcheck, 'except select source_event_id from expected');
});

test('rollback preserves raw rating evidence', async () => {
  const sql = await readFile(rollbackPath, 'utf8');
  has(sql, 'delete from public.scout_xp_ledger');
  has(sql, "x.xp_kind = 'star_rating'");
  has(sql, 'create or replace function public.set_novel_star_rating');
  assert.equal(sql.includes('delete from public.scout_event_ledger'), false);
  assert.equal(/drop table|truncate/i.test(sql), false);
});
