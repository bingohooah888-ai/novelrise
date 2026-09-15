import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20260916073000_beta_scheduled_episode_publication.sql',
  'utf8'
);
const edit = await readFile('episode-edit.html', 'utf8');
const drafts = await readFile('episode-drafts.html', 'utf8');

test('scheduled rows stay draft until due', () => {
  assert.match(migration, /add column scheduled_at timestamptz/u);
  assert.match(
    migration,
    /check \(scheduled_at is null or status = 'draft'\)/u
  );
  assert.match(
    migration,
    /where status = 'draft' and scheduled_at is not null/u
  );
  assert.doesNotMatch(migration, /status\s*=\s*'scheduled'/u);
});

test('schedule RPC is owner-bound and authenticated', () => {
  assert.match(migration, /novelight_schedule_episode_publication/u);
  assert.match(migration, /security invoker/u);
  assert.match(migration, /e\.user_id = v_user_id/u);
  assert.match(migration, /n\.user_id = v_user_id/u);
  assert.match(migration, /at least one minute in the future/u);
  assert.match(migration, /first scheduled publication must be episode 1/i);
  assert.match(
    migration,
    /grant execute on function public\.novelight_schedule_episode_publication[\s\S]*to authenticated/u
  );
  assert.match(
    migration,
    /revoke all on function public\.novelight_schedule_episode_publication[\s\S]*from anon/u
  );
});

test('due publisher is locked and client-inaccessible', () => {
  assert.match(migration, /create extension if not exists pg_cron/u);
  assert.match(migration, /for update of e, n skip locked/u);
  assert.match(migration, /e\.scheduled_at <= now\(\)/u);
  assert.match(
    migration,
    /set status = 'published',\s*scheduled_at = null/u
  );
  assert.match(migration, /novelight-publish-due-episodes/u);
  for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
    assert.match(
      migration,
      new RegExp(
        `revoke all on function public\\.novelight_publish_due_scheduled_episodes\\(\\) from ${role}`
      )
    );
  }
});

test('manual publication clears a reservation atomically', () => {
  assert.match(
    migration,
    /create or replace function public\.novelight_publish_episode_draft_atomic/u
  );
  assert.match(migration, /for update of e, n/u);
  assert.match(
    migration,
    /set status = 'published',\s*scheduled_at = null/u
  );
});

test('draft editor offers stagger-safe local-time scheduling', () => {
  assert.match(edit, /id="scheduledAt" type="datetime-local"/u);
  assert.match(edit, /id="schedulePublish"/u);
  assert.match(edit, /id="cancelSchedule"/u);
  assert.match(edit, /novelight_schedule_episode_publication/u);
  assert.match(
    edit,
    /Object\.prototype\.hasOwnProperty\.call\(episode,'scheduled_at'\)/u
  );
  assert.match(edit, /publishAt\.toISOString\(\)/u);
  assert.match(edit, /Date\.now\(\)\+60000/u);
});

test('draft manager shows reservation state safely', () => {
  assert.match(drafts, /\.from\('episodes'\)\.select\('\*'\)/u);
  assert.match(drafts, /scheduleLabel\(row\.scheduled_at\)/u);
  assert.match(drafts, /予約投稿/u);
  assert.match(drafts, /今すぐ公開/u);
});
