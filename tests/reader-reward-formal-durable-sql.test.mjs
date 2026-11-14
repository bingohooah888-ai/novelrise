import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

const sql = readFileSync(
  new URL('../docs/drafts/SCOUT_FORMAL_LEVEL_STATE_DRAFT.sql', import.meta.url),
  'utf8'
);

test('formal persistence draft cannot run automatically as a migration', () => {
  assert.match(sql, /DRAFT \/ NOT A MIGRATION/);
  assert.match(sql, /create schema if not exists novelight_formal_private/i);
  assert.doesNotMatch(sql, /create\s+trigger/i);
  assert.doesNotMatch(sql, /alter\s+table\s+public\.scout_xp_ledger/i);
  assert.doesNotMatch(sql, /update\s+public\.scout_xp_ledger/i);
  assert.doesNotMatch(sql, /create\s+or\s+replace\s+function\s+public\./i);
});

test('private state and durable XP/review unique claims exist', () => {
  assert.match(
    sql,
    /create table novelight_formal_private\.scout_level_state/i
  );
  assert.match(sql, /current_level smallint not null/i);
  assert.match(sql, /highest_level smallint not null/i);
  assert.match(sql, /level_progress_xp integer not null/i);
  assert.match(sql, /review_anchor_at timestamptz not null/i);
  assert.match(sql, /revision bigint not null/i);
  assert.match(sql, /xp_id uuid primary key/i);
  assert.match(sql, /primary key \(user_id, window_end_at\)/i);
  for (const table of [
    'scout_level_state',
    'scout_xp_claim',
    'scout_review_claim'
  ]) {
    assert.match(
      sql,
      new RegExp(
        'alter table novelight_formal_private\\.' +
          table +
          ' enable row level security',
        'i'
      )
    );
  }
});

test('formal XP pathway is gated to future service role and uses one locked state', () => {
  assert.match(
    sql,
    /grant execute on function novelight_formal_private\.apply_scout_xp\(uuid\)\s+to service_role/i
  );
  assert.match(
    sql,
    /revoke all on schema novelight_formal_private from public, anon, authenticated/i
  );
  assert.match(sql, /for update/i);
  assert.match(
    sql,
    /if exists\(select 1 from novelight_formal_private\.scout_xp_claim/i
  );
  assert.match(sql, /v_required := 400/i);
  assert.doesNotMatch(sql, /level_100_surplus_policy_pending/i);
  assert.match(sql, /if v_level=100 then v_progress:=0; end if/i);
  assert.match(sql, /level_100_progress_invalid/i);
  assert.match(sql, /revision=revision\+1/i);
  assert.match(sql, /light_seed_discovery/i);
});

test('30-day review counts all XP kinds while preserving the approved floor', () => {
  assert.match(sql, /interval '30 days'/i);
  assert.match(sql, /v_xp>=200/i);
  assert.match(sql, /v_state\.highest_level>=70 then 50 else 1/i);
  assert.match(sql, /when v_next<v_state\.current_level then 0/i);
  assert.match(sql, /scout_review_claim/i);
  assert.match(sql, /p_as_of > clock_timestamp\(\)/i);
  assert.doesNotMatch(
    sql,
    /xp_kind <> 'light_seed_discovery'\s*;\s*if v_negative/i
  );
});

test('beta handoff preserves Level 30 cap and excludes historical discovery XP', () => {
  assert.match(sql, /v_xp\.occurred_at < v_state\.review_anchor_at/);
  assert.match(sql, /least\(9570::bigint/);
  assert.match(sql, /xp_kind <> 'light_seed_discovery'/);
  assert.match(sql, /v_created_at >= p_release_at/);
  assert.match(sql, /on conflict \(user_id\) do nothing/);
  assert.match(sql, /if v_level < 30 then/);
  assert.match(sql, /review_anchor_at/);
});
