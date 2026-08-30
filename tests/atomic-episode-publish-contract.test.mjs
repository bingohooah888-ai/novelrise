import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  'supabase/migrations/20260830163000_atomic_episode_publish.sql',
  'utf8'
);
const rollback = await readFile(
  'supabase/rollback/20260830163000_atomic_episode_publish_rollback.sql',
  'utf8'
);
const episodePost = await readFile('episode-post.html', 'utf8');

test('atomic episode publication RPC preserves owner RLS and rollback ordering', () => {
  assert.match(
    migration,
    /create function public\.novelight_publish_episode_atomic\(/
  );
  assert.match(migration, /security invoker/i);
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(migration, /for update/);
  assert.match(
    migration,
    /revoke all on function public\.novelight_publish_episode_atomic[\s\S]*from public/i
  );
  assert.match(
    migration,
    /grant execute on function public\.novelight_publish_episode_atomic[\s\S]*to authenticated/i
  );

  const novelUpdate = migration.indexOf('update public.novels');
  const episodeInsert = migration.indexOf('insert into public.episodes');
  assert.ok(novelUpdate >= 0, 'novel publish update must exist');
  assert.ok(episodeInsert > novelUpdate, 'episode insert must follow novel publish');
});

test('episode post uses one RPC instead of independent table writes', () => {
  assert.match(episodePost, /client\.rpc\('novelight_publish_episode_atomic'/);
  assert.doesNotMatch(episodePost, /client\.from\('episodes'\)\.insert/);
  assert.doesNotMatch(episodePost, /client\.from\('novels'\)\.update/);
  assert.doesNotMatch(episodePost, /episodeSaved/);
});

test('atomic episode publication has an explicit rollback artifact', () => {
  assert.match(
    rollback,
    /drop function if exists public\.novelight_publish_episode_atomic\(/
  );
});
