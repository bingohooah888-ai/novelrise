import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/20261025060000_public_reader_embargo_guards.sql',
    import.meta.url
  ),
  'utf8'
);

function definition(name) {
  const header = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const start = migration.indexOf(header);
  assert.ok(start >= 0, `${name} must exist`);
  const end = migration.indexOf('$function$;', start);
  assert.ok(end > start, `${name} must be complete`);
  return migration.slice(start, end);
}

test('reader episode index excludes scheduled and prepublication rows', () => {
  const body = definition('novelight_reader_episode_index');
  assert.match(body, /e.status = 'published'/i);
  assert.match(body, /e.scheduled_publish_at <= now\(\)/i);
  assert.match(body, /e.first_published_at <= now\(\)/i);
  assert.match(body, /cardinality\(p_novel_ids\) > 50/i);
});

test('public outlines obey dates without restricting owners', () => {
  const body = definition('novelight_novel_outline');
  assert.match(body, /v_is_owner\s+or\s+\(/i);
  assert.match(body, /v_novel_status = 'published'/i);
  assert.match(body, /e.scheduled_publish_at <= now\(\)/i);
  assert.match(body, /e.first_published_at <= now\(\)/i);
});

test('public author notes exclude future publication timestamps', () => {
  const body = definition('novelight_public_author_notes');
  assert.match(body, /note.status = 'published'/i);
  assert.match(body, /note.published_at <= now\(\)/i);
  assert.match(body, /least\(greatest\(coalesce\(p_limit, 5\), 1\), 20\)/i);
});

test('migration preserves signatures and grants', () => {
  assert.doesNotMatch(migration, /\brevoke\s+(all|execute)/i);
  assert.doesNotMatch(migration, /\bdrop\s+function/i);
  assert.match(migration, /\nbegin;[\s\S]*\ncommit;\s*$/i);
});
