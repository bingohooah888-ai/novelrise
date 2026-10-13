import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

const sql = readFileSync(
  new URL(
    '../supabase/migrations/20261013210000_november_contest_rank_operator.sql',
    import.meta.url
  ),
  'utf8'
);
const rollback = readFileSync(
  new URL(
    '../supabase/rollback/20261013210000_november_contest_rank_operator_rollback.sql',
    import.meta.url
  ),
  'utf8'
);

test('operator approval requires a timestamp and immutable snapshot identity', () => {
  assert.match(sql, /p_action not in \('prepare','publish'\)/);
  assert.match(sql, /v_now < v_scheduled/);
  assert.match(sql, /v_contest[.]public_visible is not true/);
  assert.match(sql, /v_snapshot[.]id <> p_expected_snapshot_id/);
  assert.match(sql, /v_preview->>'checksum' <> p_expected_checksum/);
  assert.match(sql, /for update/);
  assert.match(sql, /operator_rank_/);
  assert.match(sql, /actor_user_id/);
  assert.match(sql, /automatic_rank_prepare/);
  assert.match(sql, /interval '15 minutes'/);
});

test('release is private and rollback retains operator evidence', () => {
  assert.match(sql, /to service_role/);
  assert.match(sql, /from public,anon,authenticated/);
  assert.match(rollback, /Operator ranking audit exists/);
  assert.match(rollback, /raise exception/);
  assert.doesNotMatch(sql, /status='active'|public_visible=true/);
});
