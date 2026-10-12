import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const migrationPath =
  '../supabase/migrations/20261012131000_november_contest_entries.sql';
const sql = readFileSync(new URL(migrationPath, import.meta.url), 'utf8');
const authorPage = readFileSync(
  new URL('../my-novels.html', import.meta.url),
  'utf8'
);
const entryClient = readFileSync(
  new URL('../novelight-contest-entry.js', import.meta.url),
  'utf8'
);

test('only authenticated authors may use enrollment', () => {
  assert.match(sql, /security definer/g);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /v_uid uuid := \(select auth\.uid\(\)\)/);
  assert.match(sql, /errcode = '42501'/);
  assert.ok(
    sql.includes(
      'revoke all on function public.novelight_contest_entry_context(text)'
    )
  );
  assert.ok(
    sql.includes(
      'revoke all on function public.novelight_contest_entry_action(text,bigint,text)'
    )
  );
  assert.ok(
    sql.includes(
      'grant execute on function public.novelight_contest_entry_context(text)'
    )
  );
  assert.ok(
    sql.includes(
      'grant execute on function public.novelight_contest_entry_action(text,bigint,text)'
    )
  );
  assert.match(sql, /to authenticated;/g);
  assert.doesNotMatch(sql, /grant execute[^;]*to anon/i);
});

test('author owns the work and has ten published chapters', () => {
  assert.match(sql, /where n\.user_id = v_uid/);
  assert.match(sql, /and user_id = v_uid/);
  assert.match(sql, /and status = 'published'/);
  assert.match(sql, /ep\.status = 'published'/);
  assert.match(sql, /v_episode_count < v_contest\.minimum_published_episodes/);
  assert.match(sql, /published_episodes_at_entry = v_episode_count/);
  assert.doesNotMatch(sql, /p_user_id/);
});

test('server rechecks the deadline after concurrent lock wait', () => {
  assert.match(sql, /v_contest\.status <> 'registration'/);
  assert.match(sql, /v_now > v_contest\.entry_deadline_at/);
  assert.match(sql, /v_now >= v_contest\.starts_at/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /for share;/);
  assert.match(sql, /v_now := pg_catalog\.clock_timestamp\(\);/);
  assert.match(sql, /for update;/);
  assert.match(sql, /v_entry\.status = 'disqualified'/);
  assert.match(
    sql,
    /v_entry\.status = 'entered' and v_entry\.novel_id = v_work\.id/
  );
});

test('withdrawal and replacement keep one author record', () => {
  assert.match(sql, /p_action not in \('enter', 'withdraw'\)/);
  assert.match(sql, /set status = 'withdrawn'/);
  assert.match(sql, /update public\.novelight_contest_entries/);
  assert.match(sql, /where id = v_entry\.id/);
  assert.match(sql, /from public\.novelight_contest_entries/);
  assert.match(sql, /status = 'entered'/);
  assert.match(sql, /insert into public\.novelight_contest_entries/);
  assert.doesNotMatch(sql, /\bupdate\s+public\.novels\b/i);
});

test('both author entry-point adapters exist', () => {
  assert.match(authorPage, /src="novelight-contest-entry\.js"/);
  assert.match(authorPage, /data-contest-novel-id/);
  assert.match(authorPage, /NovelightContestEntry\.mountMyNovels/);
  assert.match(entryClient, /window\.NovelightContestEntry/);
  assert.match(entryClient, /mountContestPage/);
  assert.match(entryClient, /buildActions/);
  assert.match(entryClient, /loadContext/);
  assert.match(entryClient, /submitAction/);
  assert.match(entryClient, /'contest_unavailable'/);
  assert.match(entryClient, /\.textContent = work\.title/);
});

test('entry does not mutate PV or general ranking', () => {
  const forbiddenWrite =
    /\bupdate\s+public\.(novels|episodes|scout_xp_ledger|episode_pv_events)\b/i;
  assert.doesNotMatch(sql, forbiddenWrite);
  assert.doesNotMatch(sql, /\bdelete\s+from\s+public\.(novels|episodes)\b/i);
  const forbiddenGrant =
    /\bgrant\s+all\s+on\s+public\.novelight_contest_entries\s+to\s+authenticated/i;
  assert.doesNotMatch(sql, forbiddenGrant);
});

test('entry functions deny undeclared public launch even if code is deployed', () => {
  assert.match(sql, /v_contest\.public_visible is not true/);
  assert.match(sql, /v_contest\.public_visible is true/);
});
