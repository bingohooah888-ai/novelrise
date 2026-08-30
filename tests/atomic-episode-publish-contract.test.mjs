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
const rpc = 'novelight_publish_episode_atomic';

test('atomic episode RPC preserves owner RLS and ordering', () => {
  assert.ok(migration.includes(`create function public.${rpc}(`));
  assert.match(migration, /security invoker/i);
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(migration, /for update/);
  assert.ok(migration.includes(`revoke all on function public.${rpc}(`));
  assert.ok(migration.includes('from public;'));
  assert.ok(migration.includes('to authenticated;'));

  const novelUpdate = migration.indexOf('update public.novels');
  const episodeInsert = migration.indexOf('insert into public.episodes');
  assert.ok(novelUpdate >= 0, 'novel publish update must exist');
  assert.ok(
    episodeInsert > novelUpdate,
    'episode insert must follow novel publish'
  );
});

test('episode post uses one RPC instead of independent table writes', () => {
  assert.ok(episodePost.includes(`client.rpc('${rpc}'`));
  assert.ok(!episodePost.includes("client.from('episodes').insert"));
  assert.ok(!episodePost.includes("client.from('novels').update"));
  assert.doesNotMatch(episodePost, /episodeSaved/);
});

test('atomic episode publication has an explicit rollback artifact', () => {
  assert.ok(rollback.includes(`drop function if exists public.${rpc}(`));
});
