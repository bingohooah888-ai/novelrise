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

const scheduleRollback = readFileSync(
  new URL(
    '../supabase/rollback/20260916100000_episode_scheduled_publication_rollback.sql',
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

test('direct novel SELECT obeys publication time but keeps owner access', () => {
  const policy = migration.split(
    'alter policy novelrise_novels_select_published_or_owner'
  )[1];
  assert.ok(policy);
  const body = policy.split(';')[0];
  assert.match(body, /first_published_at <= now\(\)/i);
  assert.match(body, /user_id = \(select auth.uid\(\)\)/i);
});

test('direct episode SELECT checks embargo and owner access', () => {
  const policy = migration.split(
    'alter policy novelrise_episodes_select_published_or_novel_owner'
  )[1];
  assert.ok(policy);
  const body = policy.split(';')[0];
  assert.match(body, /scheduled_publish_at <= now\(\)/i);
  assert.match(body, /first_published_at <= now\(\)/i);
  assert.match(body, /n.first_published_at <= now\(\)/i);
  assert.match(body, /n.user_id = \(select auth.uid\(\)\)/i);
});

test('schedule rollback restores read guards before deleting column', () => {
  const start = scheduleRollback.indexOf(
    'Publication-embargo rollback compatibility'
  );
  const removeColumn = scheduleRollback.indexOf(
    'alter table public.episodes drop column if exists scheduled_publish_at'
  );
  assert.ok(start > 0 && removeColumn > start);
  const cleanup = scheduleRollback.slice(start, removeColumn);
  assert.match(cleanup, /alter policy novelrise_episodes_select/i);
  assert.match(cleanup, /novelight_reader_episode_index/i);
  assert.match(cleanup, /novelight_novel_outline/i);
  assert.match(cleanup, /first_published_at <= now\(\)/i);
});

test('migration preserves signatures and grants', () => {
  assert.doesNotMatch(migration, /\brevoke\s+(all|execute)/i);
  assert.doesNotMatch(migration, /\bdrop\s+function/i);
  assert.match(migration, /\nbegin;[\s\S]*\ncommit;\s*$/i);
});
