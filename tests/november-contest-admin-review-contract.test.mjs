import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

const sql = readFileSync(
  new URL(
    '../supabase/migrations/20261013183000_november_contest_admin_review.sql',
    import.meta.url
  ),
  'utf8'
);
const rollback = readFileSync(
  new URL(
    '../supabase/rollback/20261013183000_november_contest_admin_review_rollback.sql',
    import.meta.url
  ),
  'utf8'
);

test('manual review is serialized, audited and service-role only', () => {
  assert.match(sql, /for update/);
  assert.match(sql, /'stale_review'/);
  assert.match(sql, /operator_review_/);
  assert.match(sql, /actor_user_id/);
  assert.match(sql, /novelight_contest_recompute_reader_score/);
  assert.match(sql, /'review_hold'/);
  assert.match(sql, /to service_role/);
  assert.match(sql, /from public,anon,authenticated/);
});

test('rollback does not silently destroy operator audit history', () => {
  assert.match(rollback, /Manual review history exists/);
  assert.match(rollback, /raise exception/);
});
