import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

const sql = readFileSync(
  new URL(
    '../supabase/migrations/20261013171000_november_contest_fraud_risk_signals.sql',
    import.meta.url
  ),
  'utf8'
);
const rollback = readFileSync(
  new URL(
    '../supabase/rollback/20261013171000_november_contest_fraud_risk_signals_rollback.sql',
    import.meta.url
  ),
  'utf8'
);

test('risk signals are private, read-only and demand human review', () => {
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /security definer/);
  assert.match(sql, /to service_role/);
  assert.match(sql, /from public,anon,authenticated/);
  assert.match(sql, /requires_manual_review/);
  assert.match(sql, /inconsistent_qualified_evidence/);
  assert.match(sql, /multiple_linked_guest_credentials/);
  assert.match(sql, /overlapping_episode_sessions/);
  assert.doesNotMatch(sql, /update public[.]novelight_contest_readers/);
  assert.doesNotMatch(sql, /delete from public[.]novelight_contest/);
});

test('risk signals have a clean reversible function-only rollback', () => {
  assert.match(rollback, /drop function if exists/);
  assert.doesNotMatch(rollback, /delete from|drop table/);
});
