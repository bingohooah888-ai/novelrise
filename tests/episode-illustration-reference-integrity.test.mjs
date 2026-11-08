import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/20261108154048_protect_episode_illustration_active_references.sql',
  'utf8'
);
const deleteMigration = readFileSync(
  'supabase/migrations/20260930193000_episode_illustration_logical_delete.sql',
  'utf8'
);
const ui = readFileSync('novelight-episode-illustrations.js', 'utf8');
const rls = readFileSync('tests/rls/episode-inline-illustrations.sql', 'utf8');
const rollback = readFileSync(
  'supabase/rollback/20261108154048_protect_episode_illustration_active_references_rollback.sql',
  'utf8'
);
const replay = readFileSync('scripts/run-migration-replay.sh', 'utf8');

test('all episode insert and manuscript updates validate active illustration references', () => {
  assert.match(
    migration,
    /create constraint trigger novelight_validate_episode_illustration_refs/
  );
  assert.match(
    migration,
    /after insert or update of content, novel_id on public\.episodes[\s\S]*deferrable initially deferred/i
  );
  assert.match(migration, /img\.id = v_id::uuid/);
  assert.match(migration, /img\.episode_id = new\.id/);
  assert.match(migration, /img\.novel_id = v_novel_id/);
  assert.match(migration, /img\.deleted_at is null/);
  assert.match(migration, /EPISODE_ILLUSTRATION_MISSING_OR_DELETED/);
});

test('delete and manuscript save are serialized by the episode row lock', () => {
  assert.match(
    deleteMigration,
    /where e\.id = p_episode_id\s+for update of e/i
  );
  assert.match(
    migration,
    /after insert or update of content, novel_id[\s\S]*deferrable initially deferred/i
  );
  assert.match(migration, /security definer\s+set search_path to ''/i);
  assert.match(
    migration,
    /revoke all on function public\.novelight_validate_episode_illustration_refs/
  );
});

test('illustration UI does not misrepresent saved metadata and preserves retry inputs', () => {
  assert.match(ui, /const submittedAlt = alt\.value/);
  assert.match(ui, /asset\.altText = submittedAlt/);
  assert.match(ui, /未保存です。もう一度保存してください/);
  assert.match(ui, /uploadBox\.querySelector\('input\[type="file"\]'\)/);
  assert.match(ui, /insert\.disabled = busy/);
  assert.match(ui, /mountedState\.retryPending = true/);
  assert.match(ui, /state\.assets = state\.assets\.filter/);
});

test('RLS integration exercises valid markers and rejects missing or deleted references', () => {
  assert.match(
    rls,
    /set constraints public\.novelight_validate_episode_illustration_refs immediate/i
  );
  assert.match(rls, /Missing illustration reference unexpectedly saved/);
  assert.match(rls, /Deleted illustration reference unexpectedly saved/);
  assert.match(rls, /when foreign_key_violation then null/);
});

test('historical illustration replay removes new guard before dropping the old schema', () => {
  assert.match(
    rollback,
    /drop trigger if exists novelight_validate_episode_illustration_refs/
  );
  assert.match(
    rollback,
    /drop function if exists public\.novelight_validate_episode_illustration_refs/
  );
  assert.match(
    replay,
    /supabase\/rollback\/20261108154048_protect_episode_illustration_active_references_rollback\.sql[\s\S]*supabase\/rollback\/20260920093847_episode_inline_illustrations_rollback\.sql/
  );
  assert.match(
    rls,
    /Skip latest reference guard in historical schema rollback fixture/
  );
});
