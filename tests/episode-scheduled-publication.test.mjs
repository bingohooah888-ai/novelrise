import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20260916132000_beta_scheduled_episode_publication.sql',
  'utf8'
);
const edit = await readFile('episode-edit.html', 'utf8');
const drafts = await readFile('episode-drafts.html', 'utf8');

test(
  'scheduled publication keeps episodes private drafts until the due worker publishes them',
  () => {
    assert.match(migration, /add column scheduled_publish_at timestamptz/u);
    assert.match(
      migration,
      /check \(scheduled_publish_at is null or status = 'draft'\)/u
    );
    assert.doesNotMatch(migration, /status\s*=\s*'scheduled'/u);
    assert.match(
      migration,
      /where e\.status = 'draft'[\s\S]*e\.scheduled_publish_at <= now\(\)/u
    );
    assert.match(
      migration,
      /set status = 'published',[\s\S]*scheduled_publish_at = null/u
    );
  }
);

test(
  'scheduled publication reuses publication safety rules and auto-clears stale schedules',
  () => {
    assert.match(migration, /novelight_schedule_episode_draft/u);
    assert.match(migration, /Only draft episodes can be scheduled/u);
    assert.match(migration, /The first published episode must be episode 1/u);
    assert.match(
      migration,
      /Episode title must contain 1 to 150 characters/u
    );
    assert.match(
      migration,
      /Episode content must contain 1 to 100000 characters/u
    );
    assert.match(migration, /novelight_clear_episode_schedule_on_change/u);
    assert.match(
      migration,
      /revoke all on function public\.novelight_clear_episode_schedule_on_change\(\) from public, anon, authenticated/u
    );
    assert.match(
      migration,
      /new\.episode_number is distinct from old\.episode_number/u
    );
    assert.match(migration, /new\.title is distinct from old\.title/u);
    assert.match(migration, /new\.content is distinct from old\.content/u);
  }
);

test('due worker is database scheduled and unavailable to normal clients', () => {
  assert.match(migration, /create extension if not exists pg_cron/u);
  assert.match(migration, /novelight_publish_due_scheduled_episodes\(\)/u);
  assert.match(
    migration,
    /revoke all on function public\.novelight_publish_due_scheduled_episodes\(\) from public, anon, authenticated/u
  );
  assert.match(
    migration,
    /grant execute on function public\.novelight_publish_due_scheduled_episodes\(\) to service_role/u
  );
  assert.match(
    migration,
    /cron\.schedule\([\s\S]*'novelight-publish-scheduled-episodes'[\s\S]*'\* \* \* \* \*'/u
  );
});

test(
  'draft editor exposes one-shot schedule controls only after the schema supports them',
  () => {
    assert.match(edit, /id="scheduleArea"/u);
    assert.match(edit, /id="scheduleAt" type="datetime-local"/u);
    assert.match(edit, /novelight_schedule_episode_draft/u);
    assert.match(edit, /novelight_cancel_episode_schedule/u);
    assert.match(
      edit,
      /Object\.prototype\.hasOwnProperty\.call\(episode,'scheduled_publish_at'\)/u
    );
    assert.match(edit, /draftChanged\(value\)/u);
    assert.match(edit, /内容変更のため予約投稿は解除されました。/u);
  }
);

test(
  'draft manager remains compatible before migration and shows schedule state afterwards',
  () => {
    assert.match(drafts, /\.select\('\*'\)/u);
    assert.match(drafts, /row\.scheduled_publish_at/u);
    assert.match(drafts, /予約中/u);
    assert.match(drafts, /今すぐ公開/u);
  }
);
