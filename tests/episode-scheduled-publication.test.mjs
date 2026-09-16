import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const migration = read(
  'supabase/migrations/20260916110000_episode_scheduled_publication.sql'
);
const schedulePage = read('episode-schedule.html');
const drafts = read('episode-drafts.html');

test('scheduled publication keeps episodes private drafts until trusted release', () => {
  assert.match(migration, /create table public\.episode_publish_schedules/);
  assert.match(migration, /Only draft episodes can be scheduled/);
  assert.match(migration, /e\.status = p_episode_id/u, 'guard against accidental regex drift');
});

test('scheduled publication uses a bounded trusted cron release path', () => {
  assert.match(migration, /create extension if not exists pg_cron/);
  assert.match(
    migration,
    /novelight-release-scheduled-episodes'[\s\S]*'\* \* \* \* \*'/
  );
  assert.match(migration, /for update skip locked[\s\S]*limit 50/);
  assert.match(migration, /state = 'failed'/);
  assert.match(migration, /last_error_code = 'release_failed'/);
});

test('only authenticated owners can create or cancel schedules', () => {
  assert.match(migration, /episode_publish_schedules_select_owner/);
  assert.match(migration, /e\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /n\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(
    migration,
    /revoke all on table public\.episode_publish_schedules from public, anon, authenticated/
  );
  assert.match(
    migration,
    /grant select on table public\.episode_publish_schedules to authenticated/
  );
  for (const fn of [
    'novelight_schedule_episode_publication',
    'novelight_cancel_episode_publication_schedule'
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn}`));
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${fn}[\\s\\S]*authenticated`)
    );
  }
});

test('beta scheduling is intentionally one pending episode per work', () => {
  assert.match(
    migration,
    /constraint episode_publish_schedules_one_per_novel unique \(novel_id\)/
  );
  assert.match(migration, /Only one episode per work can be scheduled at a time/);
  assert.match(migration, /The first scheduled publication must be episode 1/);
});

test('manual publication clears stale schedules automatically', () => {
  assert.match(
    migration,
    /create trigger episodes_clear_publish_schedule_after_release/
  );
  assert.match(
    migration,
    /old\.status = 'draft' and new\.status <> 'draft'/
  );
  assert.match(
    migration,
    /delete from public\.episode_publish_schedules where episode_id = new\.id/
  );
  assert.match(
    migration,
    /revoke all on function public\.novelight_clear_episode_publish_schedule_after_release\(\) from public, anon, authenticated/
  );
});

test('author scheduling UI is local-time aware and degrades safely before migration deploy', () => {
  assert.match(schedulePage, /type="datetime-local"/);
  assert.match(schedulePage, /novelight_schedule_episode_publication/);
  assert.match(schedulePage, /novelight_cancel_episode_publication_schedule/);
  assert.match(schedulePage, /この端末の時刻/);
  assert.match(schedulePage, /予約投稿機能は現在準備中です/);
  assert.match(schedulePage, /episode\.status!==['"]draft['"]/);
});

test('draft manager exposes schedule state without making it required', () => {
  assert.match(drafts, /episode_publish_schedules/);
  assert.match(drafts, /episode-schedule\.html\?id=/);
  assert.match(drafts, /予約投稿を設定/);
  assert.match(drafts, /scheduled publication storage is not ready/);
  assert.match(drafts, /novelight_publish_episode_draft_atomic/);
});
