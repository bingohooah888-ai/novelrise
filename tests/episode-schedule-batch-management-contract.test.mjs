import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20260918180500_episode_schedule_batch_management.sql',
  'utf8'
);
const precheck = await readFile(
  'supabase/checks/20260918180500_episode_schedule_batch_management_precheck.sql',
  'utf8'
);
const postcheck = await readFile(
  'supabase/checks/20260918180500_episode_schedule_batch_management_postcheck.sql',
  'utf8'
);
const rollback = await readFile(
  'supabase/rollback/20260918180500_episode_schedule_batch_management_rollback.sql',
  'utf8'
);
const schedulePage = await readFile('episode-schedule.html', 'utf8');
const draftPage = await readFile('episode-drafts.html', 'utf8');
const novelPage = await readFile('novel.html', 'utf8');
const myNovelsPage = await readFile('my-novels.html', 'utf8');

test('B #13 extends the existing scheduler instead of duplicating it', () => {
  assert.match(
    migration,
    /create function public\.novelight_batch_manage_episode_schedules\(/
  );
  assert.doesNotMatch(migration, /create table/iu);
  assert.doesNotMatch(migration, /cron\.schedule|create extension/iu);
  assert.match(migration, /scheduled_publish_at/);
  assert.match(migration, /novelight_publish_due_episode_schedules/);
});
test('batch schedule RPC is owner-bound, atomic, and narrowly granted', () => {
  assert.match(migration, /security invoker/iu);
  assert.match(migration, /set search_path = ''/u);
  assert.match(migration, /v_uid uuid := auth\.uid\(\)/u);
  assert.match(migration, /n\.user_id = v_uid/u);
  assert.match(migration, /e\.user_id = v_uid/u);
  assert.match(migration, /v_change_count < 1 or v_change_count > 50/u);
  assert.match(migration, /duplicate episode/iu);
  assert.match(migration, /for update/iu);
  assert.match(
    migration,
    /grant execute on function public\.novelight_batch_manage_episode_schedules\(bigint, jsonb\)[\s\S]*to authenticated/iu
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function public\.novelight_batch_manage_episode_schedules\(bigint, jsonb\)[\s\S]*to authenticated, service_role/iu
  );
});

test('unpublished works enforce episode 1 as the strictly first release', () => {
  assert.match(migration, /v_novel_status <> 'published'/u);
  assert.match(
    migration,
    /Episode 1 must be the first scheduled publication for an unpublished work/u
  );
  assert.match(
    migration,
    /Later episodes must be scheduled after episode 1 for an unpublished work/u
  );
  assert.match(
    migration,
    /e\.episode_number <> 1[\s\S]*e\.scheduled_publish_at <= v_first_schedule/u
  );
});

test('batch management remains outside evaluation and discovery systems', () => {
  assert.match(
    migration,
    /does not alter Rank, LIGHT SEED, SCOUT, PV, favorites, discovery, or exposure/u
  );
  assert.doesNotMatch(
    migration,
    /light_seed|scout_xp|scout_event|novel_exposure|favorite_count|recalculate_work_rank/iu
  );
});
test('author schedule page supports timetable fill, batch cancel, and dirty-only saves', () => {
  assert.match(schedulePage, /予約公開管理/u);
  assert.match(schedulePage, /公開間隔（分）/u);
  assert.match(schedulePage, /選択話に時間割を入力/u);
  assert.match(schedulePage, /選択話の予約を解除/u);
  assert.match(schedulePage, /data-original-local/u);
  assert.match(schedulePage, /input\.value!==card\.dataset\.originalLocal/u);
  assert.match(schedulePage, /novelight_batch_manage_episode_schedules/u);
  assert.match(schedulePage, /p_changes:changes/u);
  assert.match(
    schedulePage,
    /Number\(a\.dataset\.number\)-Number\(b\.dataset\.number\)/u
  );
  assert.match(schedulePage, /データベース反映待ちです/u);
});

test('schedule management is reachable from author work surfaces', () => {
  assert.match(draftPage, /episode-schedule\.html\?novel_id=/u);
  assert.match(novelPage, /id="manageSchedule"/u);
  assert.match(novelPage, /episode-schedule\.html\?novel_id=/u);
  assert.match(myNovelsPage, /episode-schedule\.html\?novel_id=/u);
});

test('B #13 ships fail-closed checks and a non-destructive rollback', () => {
  assert.match(
    precheck,
    /PRECHECK PASS: B #13 batch schedule prerequisites are ready/u
  );
  assert.match(
    postcheck,
    /POSTCHECK PASS: B #13 batch scheduling is owner-only, atomic, and reuses the existing scheduler/u
  );
  assert.match(postcheck, /SECURITY INVOKER/u);
  assert.match(postcheck, /has_function_privilege/iu);
  assert.match(
    rollback,
    /drop function if exists public\.novelight_batch_manage_episode_schedules/iu
  );
  assert.doesNotMatch(rollback, /drop column|drop table|cron\.unschedule/iu);
});
