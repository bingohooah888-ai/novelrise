import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

const sql = readFileSync(
  new URL(
    '../supabase/migrations/20261013194500_november_contest_ranking_snapshots.sql',
    import.meta.url
  ),
  'utf8'
);
const rollback = readFileSync(
  new URL(
    '../supabase/rollback/20261013194500_november_contest_ranking_snapshots_rollback.sql',
    import.meta.url
  ),
  'utf8'
);

test('rank scheduling uses fixed JST noon slots and no live PV', () => {
  for (const date of ['2026-11-07', '2026-11-15', '2026-11-22']) {
    assert.match(sql, new RegExp(date + ' 03:00:00[+]00'));
  }
  assert.match(sql, /pg_catalog[.]rank\(\) over/);
  assert.match(sql, /row_number\(\) over/);
  assert.match(sql, /position <= 10/);
  assert.match(sql, /pg_catalog[.]count\(distinct ev[.]episode_id_snapshot\)/);
  assert.doesNotMatch(sql, /sum\(pv\)|novelight_ranking_feed/);
});

test('publication stays separate, time gated and fails closed', () => {
  assert.match(sql, /v_snapshot[.]created_at < v_scheduled/);
  assert.match(sql, /ranking_unavailable/);
  assert.match(sql, /ranking_not_published/);
  assert.match(sql, /snapshot_not_ready/);
  assert.match(sql, /v_contest[.]public_visible is not true/);
  assert.match(sql, /to service_role/);
  assert.match(sql, /to anon,authenticated/);
  assert.match(sql, /content_rating in \('general','sensitive_15','mature'\)/);
  assert.match(sql, /n[.]ai_usage in \('human','ai_assisted'\)/);
});

test('rollback refuses to remove published ranking history', () => {
  assert.match(rollback, /Published ranking history exists/);
  assert.match(rollback, /raise exception/);
});
