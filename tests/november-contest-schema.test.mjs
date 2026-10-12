import test from 'node:test';
import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationPath =
  '../supabase/migrations/20261012130000_november_contest_schema.sql';
const sql = readFileSync(new URL(migrationPath, import.meta.url), 'utf8');

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

test('contest foundation keeps its tables private', () => {
  for (const table of tables) {
    const pattern = new RegExp(
      'create table public\\.' + table + '\\s*\\(',
      'i'
    );
    assert.match(sql, pattern);
    assert.ok(sql.includes("'" + table + "'"));
  }
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /from public, anon, authenticated/i);
  assert.match(sql, /grant all on table public\.%I to service_role/i);
  assert.doesNotMatch(sql, /grant all on public\.novelight_contests to anon/i);
});

test('unique work and episode constraints are present', () => {
  assert.match(sql, /unique \(contest_id, author_id\)/);
  assert.match(sql, /unique \(contest_id, novel_id\)/);
  assert.match(sql, /unique \(contest_id, reader_id, episode_id_snapshot\)/);
  assert.match(sql, /foreign key \(reader_id, contest_id\)/);
  assert.match(sql, /foreign key \(entry_id, contest_id\)/);
  assert.match(sql, /foreign key \(merged_into_reader_id, contest_id\)/);
  assert.match(sql, /foreign key \(snapshot_id, contest_id\)/);
});

test('November JST boundaries and prize tiers are locked', () => {
  assert.match(sql, /'2026-10-31 15:00:00\+00'/);
  assert.match(sql, /'2026-11-30 15:00:00\+00'/);
  assert.match(sql, /'2026-10-31 14:59:59\.999999\+00'/);
  assert.match(sql, /\{"3":1,"5":3,"10":5\}/);
  assert.match(sql, /points in \(0,1,3,5\)/);
  assert.match(sql, /qualified_episode_count between 3 and 4 and points = 1/);
  assert.match(sql, /qualified_episode_count between 5 and 9 and points = 3/);
  assert.match(sql, /qualified_episode_count >= 10 and points = 5/);
  assert.match(sql, /award_rank_limit = 5/);
  assert.match(sql, /amount_yen = 10000/);
});

test('publication is independently default-hidden and cannot open registration alone', () => {
  assert.match(sql, /public_visible boolean not null default false/);
  assert.match(
    sql,
    /status not in \('registration','active'\) or public_visible/
  );
});

test('stage 02 stays in draft and does not alter ordinary PV', () => {
  assert.match(sql, /'draft',\s*'2026-10-31 14:59:59\.999999\+00'/);
  assert.doesNotMatch(sql, /update\s+public\.novels/i);
  assert.doesNotMatch(sql, /update\s+public\.episodes/i);
  assert.doesNotMatch(sql, /create\s+or\s+replace\s+function/i);
  assert.doesNotMatch(sql, /alter\s+table\s+public\.novels/i);
});

test('the prize ledger avoids bank account details', () => {
  assert.match(sql, /create table public\.novelight_contest_awards/i);
  assert.doesNotMatch(sql, /bank_account\s+\w+/i);
  assert.doesNotMatch(sql, /account_number\s+\w+/i);
});
