import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../supabase/migrations/20261012010000_november_contest_schema.sql', import.meta.url),
  'utf8'
);

const tables = [
  'novelight_contests',
  'novelight_contest_entries',
  'novelight_contest_readers',
  'novelight_contest_read_sessions',
  'novelight_contest_read_events',
  'novelight_contest_reader_scores',
  'novelight_contest_rank_snapshots',
  'novelight_contest_rank_rows',
  'novelight_contest_awards',
  'novelight_contest_review_audit'
];

test('contest foundation creates only private isolated tables', () => {
  for (const table of tables) {
    assert.match(sql, new RegExp('create table public\\.' + table + '\\s*\\(', 'i'));
    assert.ok(sql.includes("'" + table + "'"), table + ' must be in RLS deny-by-default loop');
  }
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.%I from public, anon, authenticated/i);
  assert.match(sql, /grant all on table public\.%I to service_role/i);
  assert.doesNotMatch(sql, /grant\s+(?:select|insert|update|delete|all)\s+on\s+(?:table\s+)?public\.novelight_contest\w*\s+to\s+(?:anon|authenticated)/i);
});

test('one author one work, same reader episode dedupe, same-contest FKs are enforced', () => {
  assert.match(sql, /unique \(contest_id, author_id\)/);
  assert.match(sql, /unique \(contest_id, novel_id\)/);
  assert.match(sql, /unique \(contest_id, reader_id, episode_id_snapshot\)/);
  assert.match(sql, /foreign key \(reader_id, contest_id\)/);
  assert.match(sql, /foreign key \(entry_id, contest_id\)/);
  assert.match(sql, /foreign key \(merged_into_reader_id, contest_id\)/);
  assert.match(sql, /foreign key \(snapshot_id, contest_id\)/);
});

test('11/1 to 11/30 JST contest has immutable score tiers and five award ranks', () => {
  assert.match(sql, /'2026-10-31 15:00:00\+00'/);
  assert.match(sql, /'2026-11-30 15:00:00\+00'/);
  assert.match(sql, /'2026-10-31 14:59:59\+00'/);
  assert.match(sql, /\{"3":1,"5":3,"10":5\}/);
  assert.match(sql, /points in \(0,1,3,5\)/);
  assert.match(sql, /qualified_episode_count between 3 and 4 and points = 1/);
  assert.match(sql, /qualified_episode_count between 5 and 9 and points = 3/);
  assert.match(sql, /qualified_episode_count >= 10 and points = 5/);
  assert.match(sql, /award_rank_limit = 5/);
  assert.match(sql, /amount_yen = 10000/);
});

test('no enrollment begins in stage 02 and no existing analytics counters are mutated', () => {
  assert.match(sql, /'draft',\s*'2026-10-31 14:59:59\+00'/);
  assert.doesNotMatch(sql, /\bupdate\s+public\.(?:novels|episodes|scout_xp_ledger|valid_read_events|episode_pv_events)\b/i);
  assert.doesNotMatch(sql, /create\s+or\s+replace\s+function/i);
  assert.doesNotMatch(sql, /alter\s+table\s+public\.(?:novels|episodes|valid_read_events)\b/i);
});

test('the contest award ledger stores no bank account or payment secret', () => {
  assert.match(sql, /create table public\.novelight_contest_awards/i);
  assert.doesNotMatch(sql, /(?:bank_account|account_number|routing_number|bank_branch|api_key|secret_key)\s+\w+/i);
});
