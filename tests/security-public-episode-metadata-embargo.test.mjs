import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/20261025073000_public_episode_metadata_embargo.sql',
    import.meta.url
  ),
  'utf8'
);
const rollback = readFileSync(
  new URL(
    '../supabase/rollback/20260916100000_episode_scheduled_publication_rollback.sql',
    import.meta.url
  ),
  'utf8'
);

const names = [
  'novelight_character_feed',
  'novelight_episode_comment_feed',
  'novelight_episode_heart_state',
  'novelight_novel_character_feed',
  'novelight_typo_report_state'
];

function functionBody(source, name) {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing ${name}`);
  const end = source.indexOf('$function$;', start);
  assert.ok(end > start, `unclosed ${name}`);
  return source.slice(start, end);
}

test('all remaining episode-metadata RPCs enforce publication dates', () => {
  for (const name of names) {
    const body = functionBody(migration, name);
    assert.match(body, /scheduled_publish_at <= now\(\)/i);
    assert.match(body, /first_published_at <= now\(\)/i);
    assert.match(body, /status = 'published'/i);
  }
});

test('character feeds retain author preview but hide upcoming chapters', () => {
  const episode = functionBody(migration, 'novelight_character_feed');
  const novel = functionBody(migration, 'novelight_novel_character_feed');
  assert.match(episode, /v_uid = v_owner_id/i);
  assert.match(episode, /first_episode.scheduled_publish_at <= now\(\)/i);
  assert.match(novel, /v_uid = v_author_id/i);
  assert.match(novel, /e2.scheduled_publish_at <= now\(\)/i);
});

test('old scheduling rollback removes function dependencies first', () => {
  const drop = rollback.indexOf(
    'alter table public.episodes drop column if exists scheduled_publish_at'
  );
  assert.ok(drop > 0);
  for (const name of names) {
    const restored = functionBody(rollback, name);
    assert.ok(rollback.indexOf(restored) < drop);
    assert.doesNotMatch(restored, /scheduled_publish_at/i);
    assert.match(restored, /first_published_at <= now\(\)/i);
  }
});

test('transactional migration preserves public grants', () => {
  assert.match(migration, /\nbegin;[\s\S]*\ncommit;\s*$/i);
  assert.doesNotMatch(migration, /\brevoke\s+(all|execute)/i);
  assert.doesNotMatch(migration, /\bdrop\s+function/i);
});
