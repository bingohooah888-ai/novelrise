import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const source = readFileSync(
  new URL('../docs/drafts/SCOUT_FORMAL_XP_CUTOVER_DRAFT.sql', import.meta.url),
  'utf8'
);

test('formal cutover is dormant and cannot auto-run as Supabase migration', () => {
  assert.match(source, /DRAFT, DO NOT APPLY to Staging beta or Production/);
  assert.match(source, /outside supabase\/migrations/);
  assert.match(source, /separately approved formal release cutover/);
  assert.match(source, /outside supabase\/migrations/);
});

test('future formal capture reuses existing XP ledger and level state', () => {
  assert.match(
    source,
    /create or replace function public\.novelight_cap_scout_xp_beta\(\)/i
  );
  assert.match(
    source,
    /create or replace function novelight_formal_private\.on_scout_xp_insert\(\)/i
  );
  assert.match(source, /after insert on public\.scout_xp_ledger/i);
  assert.match(source, /novelight_formal_private\.apply_scout_xp\(new\.id\)/i);
  assert.match(source, /scout_formal_xp_after_insert/i);
  assert.doesNotMatch(source, /create\s+table/i);
  assert.doesNotMatch(source, /update\s+public\.scout_xp_ledger/i);
  assert.doesNotMatch(source, /delete\s+from\s+public\.scout_xp_ledger/i);
  assert.match(source, /insert\s+into\s+public\.scout_point_ledger/i);
});

test('future uninitialized accounts and pending outcomes are not silently advanced', () => {
  assert.match(source, /not exists \([\s\S]*scout_level_state/i);
  assert.match(source, /review_due_first/);
  assert.match(source, /closed_or_pre_release_window/);
  assert.match(source, /level_100_surplus_policy_pending/);
  assert.match(source, /adjustment_policy_pending/);
  assert.match(source, /drop trigger if exists scout_xp_level_up_points/i);
  assert.match(
    source,
    /create or replace function novelight_formal_private\.initialize_new_reader/i
  );
  assert.match(
    source,
    /create or replace function novelight_formal_private\.resume_pending_scout_xp/i
  );
  assert.match(source, /on conflict\(event_key\) do nothing/i);
  assert.match(source, /point_value,status,event_key/i);
});

test('the future Point writer is inside the same XP transaction and never reissues first-level rewards', () => {
  assert.match(
    source,
    /for v_promoted in \(v_state.current_level\+1\)\.\.v_level loop/i
  );
  assert.match(
    source,
    /'level_up:'\|\|v_xp.user_id::text\|\|':'\|\|v_promoted::text/i
  );
  assert.match(source, /'level_up',50,'confirmed'/i);
  assert.match(source, /on conflict\(event_key\) do nothing/i);
  assert.match(source, /drop trigger if exists scout_xp_level_up_points/i);
});
test('pending XP replay is explicitly invoked and processes review windows in chronological order', () => {
  assert.match(source, /resume_pending_scout_xp\(/i);
  assert.match(source, /order by x.occurred_at,x.id limit p_limit/i);
  assert.match(source, /review_scout_30_days\(p_user_id,p_as_of\)/i);
  assert.match(source, /apply_scout_xp\(v_xp.id\)/i);
  assert.match(source, /p_limit > 100/i);
  assert.match(source, /'status','more_pending'/i);
  assert.match(
    source,
    /Never close a maintenance window while older unclaimed XP/
  );
  assert.doesNotMatch(source, /create\s+extension\s+pg_cron/i);
});
