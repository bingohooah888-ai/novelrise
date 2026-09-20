import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath =
  'supabase/migrations/20260920223049_scout_record_beta_core.sql';
const precheckPath =
  'supabase/checks/20260920223049_scout_record_beta_core_precheck.sql';
const postcheckPath =
  'supabase/checks/20260920223049_scout_record_beta_core_postcheck.sql';
const rollbackPath =
  'supabase/rollback/20260920223049_scout_record_beta_core_rollback.sql';

function has(text, token) {
  assert.equal(text.includes(token), true, `missing token: ${token}`);
}

test('Chapter 49 beta core adds private level and point ledgers', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  has(sql, 'create table public.scout_level_thresholds');
  has(sql, 'create table public.scout_point_ledger');
  has(sql, "status in ('confirmed', 'pending', 'frozen', 'cancelled')");
  has(sql, 'reversal_of uuid references public.scout_point_ledger');
  has(sql, 'alter table public.scout_point_ledger enable row level security');
  has(sql, 'revoke all on table public.scout_point_ledger from public, anon, authenticated');
  has(sql, 'revoke all on table public.scout_level_thresholds from public, anon, authenticated');
});

test('beta Level progression caps XP at Lv.30 without rewriting old ledger rows', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  has(sql, 'generate_series(1, 30)');
  has(sql, 'create trigger scout_xp_beta_level_cap');
  has(sql, 'v_remaining := v_cap::bigint - greatest(v_current, 0)');
  has(sql, 'return null;');
  has(sql, 'new.xp_value := least');
  assert.doesNotMatch(sql, /update\s+public\.scout_xp_ledger\s+set/iu);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.scout_xp_ledger/iu);
});

test('new valid-read events award fixed XP with daily and lifetime work caps', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  has(sql, "new.event_type <> 'valid_read'");
  has(sql, "x.xp_kind = 'valid_read'");
  has(sql, "e.novel_id_snapshot = new.novel_id_snapshot");
  has(sql, 'v_awarded_today < 5');
  has(sql, "'valid_read', 2, 'chapter49-beta-v1'");
  has(sql, 'novelight:valid-read-xp:');
  has(sql, 'after insert on public.scout_event_ledger');
});

test('Scout Point awards Level Up and discovery milestones idempotently', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  has(sql, "'level_up'");
  has(sql, '5,');
  has(sql, "'level_up:' || new.user_id::text || ':' || v_level::text");
  has(sql, 'when v_delta >= 5 then 200');
  has(sql, 'when v_delta = 4 then 100');
  has(sql, 'when v_delta = 3 then 50');
  has(sql, 'when v_delta = 2 then 20');
  has(sql, "'nova_prediction', 25");
  has(sql, "p.point_kind = 'discovery'");
  has(sql, 'v_award := greatest(v_target - v_current, 0)');
  has(sql, 'on conflict (event_key) do nothing');
});

test('owner SCOUT RECORD APIs expose only bounded authenticated views', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  for (const fn of [
    'novelight_scout_record_summary',
    'novelight_scout_point_history',
    'novelight_scout_recent_activity',
    'novelight_scout_discoveries'
  ]) {
    has(sql, `public.${fn}`);
  }
  has(sql, 'v_uid uuid := (select auth.uid())');
  has(sql, "raise exception using errcode = '42501', message = 'Authentication required'");
  has(sql, 'where p.user_id = (select auth.uid())');
  has(sql, 'where e.user_id = (select auth.uid())');
  has(sql, 'where d.reader_id = (select auth.uid())');
  has(sql, 'limit least(greatest(coalesce(p_limit, 30), 1), 100)');
  has(sql, 'limit least(greatest(coalesce(p_limit, 20), 1), 100)');
  assert.doesNotMatch(sql, /grant\s+select\s+on\s+public\.scout_/iu);
});

test('migration explicitly avoids unresolved retroactive reward decisions', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  has(sql, 'this migration does not invent retroactive rewards');
  has(sql, 'historical valid');
  assert.doesNotMatch(
    sql,
    /insert\s+into\s+public\.scout_xp_ledger[\s\S]{0,600}select\s+/iu
  );
});

test('precheck and postcheck keep the SCOUT beta core fail closed', async () => {
  const precheck = await readFile(precheckPath, 'utf8');
  const postcheck = await readFile(postcheckPath, 'utf8');
  has(precheck, 'Chapter 38 SCOUT foundations');
  has(precheck, 'Chapter 49 SCOUT beta core already exists');
  has(postcheck, 'v_threshold_count <> 30 or v_cap <> 9570');
  has(postcheck, 'Scout Point ledger must remain RPC-only and private');
  has(postcheck, 'SCOUT RECORD summary RPC grants are incorrect');
  has(postcheck, 'Valid-read Scout XP rule drifted');
  has(postcheck, 'Scout Point discovery rule drifted');
});

test('rollback disables Chapter 49 mutations without deleting earned audit history', async () => {
  const sql = await readFile(rollbackPath, 'utf8');
  has(sql, 'drop trigger if exists scout_event_discovery_points');
  has(sql, 'drop trigger if exists scout_xp_level_up_points');
  has(sql, 'drop trigger if exists scout_event_valid_read_xp');
  has(sql, 'drop trigger if exists scout_xp_beta_level_cap');
  has(sql, 'Data already earned is kept as');
  assert.doesNotMatch(sql, /delete\s+from|truncate\s+|drop\s+table/iu);
});
