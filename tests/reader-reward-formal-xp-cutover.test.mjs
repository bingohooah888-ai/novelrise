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
  assert.match(source, /NOT a complete release migration/);
});

test('future formal capture reuses existing XP ledger and level state', () => {
  assert.match(source, /create or replace function public\.novelight_cap_scout_xp_beta\(\)/i);
  assert.match(source, /create or replace function novelight_formal_private\.on_scout_xp_insert\(\)/i);
  assert.match(source, /after insert on public\.scout_xp_ledger/i);
  assert.match(source, /novelight_formal_private\.apply_scout_xp\(new\.id\)/i);
  assert.match(source, /scout_formal_xp_after_insert/i);
  assert.doesNotMatch(source, /create\s+table/i);
  assert.doesNotMatch(source, /update\s+public\.scout_xp_ledger/i);
  assert.doesNotMatch(source, /delete\s+from\s+public\.scout_xp_ledger/i);
  assert.doesNotMatch(source, /insert\s+into\s+public\.scout_point_ledger/i);
});

test('future uninitialized accounts and pending outcomes are not silently advanced', () => {
  assert.match(source, /not exists \([\s\S]*scout_level_state/i);
  assert.match(source, /review_due_first/);
  assert.match(source, /closed_or_pre_release_window/);
  assert.match(source, /level_100_surplus_policy_pending/);
  assert.match(source, /adjustment_policy_pending/);
  assert.match(source, /legacy scout_xp_level_up_points trigger/i);
  assert.match(source, /UNFINISHED step/);
});
