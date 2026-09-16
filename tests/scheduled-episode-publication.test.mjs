import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20260916114500_scheduled_episode_publication.sql',
  'utf8'
);
const rollback = await readFile(
  'supabase/rollback/20260916114500_scheduled_episode_publication_rollback.sql',
  'utf8'
);
const post = await readFile('episode-post.html', 'utf8');
const edit = await readFile('episode-edit.html', 'utf8');
const drafts = await readFile('episode-drafts.html', 'utf8');

test('scheduled publication stores one private scheduled draft per novel', () => {
  assert.match(migration, /add column scheduled_publish_at timestamptz/u);
  assert.match(migration, /add column scheduled_publish_error text/u);
  assert.match(migration, /episodes_one_scheduled_draft_per_novel_idx/u);
  assert.match(
    migration,
    /where status = 'draft' and scheduled_publish_at is not null/u
  );
  assert.match(
    migration,
    /Only one episode per novel can be scheduled at a time/u
  );
});

test('authors can schedule and cancel only through authenticated owner RPCs', () => {
  assert.match(migration, /novelight_schedule_episode_publication/u);
  assert.match(migration, /novelight_cancel_episode_schedule/u);
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/u);
  assert.match(
    migration,
    /grant execute on function public\.novelight_schedule_episode_publication\(bigint,timestamptz\) to authenticated/u
  );
  assert.match(
    migration,
    /grant execute on function public\.novelight_cancel_episode_schedule\(bigint\) to authenticated/u
  );
  assert.match(migration, /The first scheduled publication must be episode 1/u);
});

test('due publication is server-only, concurrent-safe, and runs every minute', () => {
  assert.match(migration, /create extension if not exists pg_cron/u);
  assert.match(migration, /novelight_publish_due_episodes/u);
  assert.match(migration, /for update skip locked/u);
  assert.match(
    migration,
    /revoke all on function public\.novelight_publish_due_episodes\(\) from authenticated/u
  );
  assert.match(migration, /'novelight-publish-due-episodes'/u);
  assert.match(migration, /'\* \* \* \* \*'/u);
  assert.match(migration, /pg_cron is unavailable in compatibility replay/u);
});

test('manual draft publication clears stale schedule metadata', () => {
  assert.match(migration, /novelight_clear_episode_schedule_on_publish/u);
  assert.match(migration, /before update of status on public\.episodes/u);
  assert.match(migration, /new\.scheduled_publish_at := null/u);
  assert.match(migration, /new\.scheduled_publish_error := null/u);
});

test('scheduled publication validates content again before automatic release', () => {
  assert.match(
    migration,
    /char_length\(trim\(coalesce\(v_episode\.title, ''\)\)\) < 1/u
  );
  assert.match(
    migration,
    /char_length\(trim\(coalesce\(v_episode\.content, ''\)\)\) < 1/u
  );
  assert.match(migration, /scheduled_publish_error = v_error/u);
  assert.match(migration, /scheduled_publish_at = null/u);
});

test('episode authoring exposes direct single schedule controls', () => {
  assert.match(post, /id="scheduleAt"/u);
  assert.match(post, /id="scheduleDraft"/u);
  assert.match(post, /novelight_schedule_episode_publication/u);
  assert.match(post, /通常は指定時刻から約1分以内/u);
  assert.match(post, /schedule_error=1/u);
});

test('draft editing can change or cancel a schedule and preserves immediate publish', () => {
  assert.match(edit, /id="scheduleAt"/u);
  assert.match(edit, /id="scheduleDraft"/u);
  assert.match(edit, /id="cancelSchedule"/u);
  assert.match(edit, /novelight_schedule_episode_publication/u);
  assert.match(edit, /novelight_cancel_episode_schedule/u);
  assert.match(edit, /novelight_publish_episode_draft_atomic/u);
});

test('draft list shows schedule and automatic publication errors', () => {
  assert.match(drafts, /scheduled_publish_at/u);
  assert.match(drafts, /scheduled_publish_error/u);
  assert.match(drafts, /予約公開/u);
  assert.match(drafts, /予約中/u);
});

test('rollback removes the scheduler and schema additions without dropping pg_cron', () => {
  assert.match(rollback, /cron\.unschedule/u);
  assert.match(
    rollback,
    /drop trigger if exists novelight_clear_episode_schedule_on_publish/u
  );
  assert.match(rollback, /drop column if exists scheduled_publish_at/u);
  assert.doesNotMatch(rollback, /drop extension.*pg_cron/iu);
});
