import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const migration = read(
  'supabase/migrations/20261016212500_public_readable_episode_titles.sql'
);
const rollback = read(
  'supabase/rollback/20261016212500_public_readable_episode_titles_rollback.sql'
);
const master = read('docs/NOVELIGHT-MASTER.md');
const reading = read('novelight-reading-continuity.js');

function functionDefinition(source, name) {
  const marker = `create or replace function public.${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing ${name}`);
  const end = source.indexOf('\nrevoke all on function', start);
  assert.ok(end > start, `missing grant boundary for ${name}`);
  return source.slice(start, end);
}

test('public episode index keeps publication and batching guards', () => {
  const def = functionDefinition(migration, 'novelight_reader_episode_index');
  assert.match(def, /cardinality\(p_novel_ids\) > 50/u);
  assert.match(def, /cardinality\(array\(select distinct x/u);
  assert.match(def, /n\.status = 'published'/u);
  assert.match(def, /e\.status = 'published'/u);
  assert.match(def, /e\.title as episode_title/u);
  assert.doesNotMatch(def, /valid_read_events|reveal_through/u);
});

test('published chapter titles are visible without a read-progress gate', () => {
  const def = functionDefinition(
    migration,
    'novelight_reader_episode_chapter_index'
  );
  assert.match(def, /novelight_reader_episode_index\(p_novel_ids\)/u);
  assert.match(def, /e\.status = 'published'/u);
  assert.match(def, /c\.title as chapter_title/u);
  assert.doesNotMatch(def, /idx\.episode_title is not null/u);
});

test('follow notifications reveal only published titles to authorized followers', () => {
  const def = functionDefinition(
    migration,
    'novelight_followed_author_updates'
  );
  assert.match(def, /v_uid is null/u);
  assert.match(def, /f\.follower_user_id = v_uid/u);
  assert.match(def, /n\.status = 'published'/u);
  assert.match(def, /ep\.status = 'published'/u);
  assert.match(def, /'episode_title', ep\.title/u);
  assert.match(def, /user_blocks/u);
  assert.match(def, /user_mutes/u);
  assert.doesNotMatch(def, /valid_read_events/u);
});

test('metadata RPC privileges are explicit and rollback restores prior behavior', () => {
  assert.match(migration, /set search_path = ''/u);
  assert.match(
    migration,
    /grant execute on function public\.novelight_reader_episode_index\(text\[\]\)\s+to anon, authenticated;/u
  );
  assert.match(
    migration,
    /grant execute on function public\.novelight_followed_author_updates\(integer\)\s+to authenticated;/u
  );
  assert.match(
    functionDefinition(rollback, 'novelight_reader_episode_index'),
    /valid_read_events/u
  );
  assert.match(
    functionDefinition(rollback, 'novelight_followed_author_updates'),
    /valid_read_events/u
  );
});

test('MASTER separates published titles from other spoiler protections', () => {
  assert.match(master, /公開済み作品のエピソードタイトルと章タイトルは/u);
  assert.match(master, /読者の未読／読了状態やログイン状態に関係なく/u);
  assert.match(master, /ネタバレ指定コメント/u);
  assert.match(reading, /episodeNavigationTitle\(next\)/u);
});
