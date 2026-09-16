import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20260916100000_episode_scheduled_publication.sql',
  'utf8'
);
const precheck = await readFile(
  'supabase/checks/20260916100000_episode_scheduled_publication_precheck.sql',
  'utf8'
);
const postcheck = await readFile(
  'supabase/checks/20260916100000_episode_scheduled_publication_postcheck.sql',
  'utf8'
);
const rollback = await readFile(
  'supabase/rollback/20260916100000_episode_scheduled_publication_rollback.sql',
  'utf8'
);
const editor = await readFile('episode-edit.html', 'utf8');
const scheduleUi = await readFile('novelight-episode-schedule.js', 'utf8');

test('scheduled publication keeps episodes private drafts until database publication', () => {
  assert.match(migration, /add column scheduled_publish_at timestamptz/u);
  assert.match(migration, /scheduled_publish_at is null or status = 'draft'/u);
  assert.match(migration, /novelight_schedule_episode_draft/u);
  assert.match(migration, /novelight_cancel_episode_schedule/u);
  assert.match(migration, /novelight_publish_due_episode_schedules/u);
  assert.match(migration, /for update skip locked/u);
  assert.match(migration, /'\* \* \* \* \*'/u);
  assert.match(migration, /create extension pg_cron/u);
});

test('scheduled publication preserves owner and internal execution boundaries', () => {
  assert.match(
    migration,
    /grant execute on function public\.novelight_schedule_episode_draft\(bigint, timestamptz\) to authenticated/u
  );
  assert.match(
    migration,
    /revoke all on function public\.novelight_publish_due_episode_schedules\(\) from public, anon, authenticated, service_role/u
  );
  assert.match(postcheck, /has_function_privilege/u);
  assert.match(precheck, /RLS must be enabled on episodes/u);
});

test('scheduled publication rollback refuses to lose active schedules', () => {
  assert.match(rollback, /scheduled episodes still exist/u);
  assert.match(rollback, /cron\.unschedule/u);
  assert.match(rollback, /drop column if exists scheduled_publish_at/u);
  assert.match(
    rollback,
    /create or replace function public\.novelight_publish_episode_draft_atomic/u
  );
  assert.doesNotMatch(rollback, /drop extension[^\n]*pg_cron/u);
});

test('draft editor exposes scheduling only after the database column exists', () => {
  assert.match(editor, /novelight-episode-schedule\.js/u);
  assert.match(
    scheduleUi,
    /hasOwnProperty\.call\(episode, 'scheduled_publish_at'\)/u
  );
  assert.match(scheduleUi, /novelight_schedule_episode_draft/u);
  assert.match(scheduleUi, /novelight_cancel_episode_schedule/u);
  assert.match(scheduleUi, /await saveServerDraft\(\)/u);
  assert.match(scheduleUi, /requested\.toISOString\(\)/u);
  assert.doesNotThrow(() => new Function(scheduleUi));
});
