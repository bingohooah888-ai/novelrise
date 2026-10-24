import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) =>
  readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const migrationPath =
  'supabase/migrations/20261024141500_community_official_announcement_owner_avatar.sql';
const migration = read(migrationPath);

test('official icon uses original admin creator and live profile', () => {
  const terms = [
    "audit.action='announcement.create'",
    "audit.resource_type='announcement'",
    "audit.resource_id=split_part(a.post_key, ':', 2)",
    'ORDER BY audit.id ASC',
    'official_profile.avatar_path',
    'official_profile.id',
    "'author_avatar_user_id',p.author_avatar_user_id"
  ];
  for (const term of terms) {
    assert.ok(migration.includes(term), term);
  }
  for (const table of ['public.profiles', 'public.admin_operation_audit']) {
    assert.ok(!migration.includes('GRANT SELECT ON TABLE ' + table));
  }
  assert.ok(!migration.includes('UPDATE public.announcements'));
});

test('official brand, visibility gates, and RPC grants remain intact', () => {
  const terms = [
    'community_runtime_control',
    'community_hidden_posts',
    'user_blocks',
    'user_mutes',
    "a.status='published'",
    "CASE WHEN p.kind='official' THEN 'NOVELIGHT公式'",
    'REVOKE ALL ON FUNCTION public.novelight_community_feed',
    'GRANT EXECUTE ON FUNCTION public.novelight_community_feed'
  ];
  for (const term of terms) {
    assert.ok(migration.includes(term), term);
  }
  assert.ok(
    migration.includes(
      "SELECT 'official', 'official:' || a.id::text,\n           NULL::uuid"
    )
  );
});

test('UI paints official owner icon with the original N fallback', () => {
  const ui = read('novelight-community.js');
  const terms = [
    "row.kind === 'official'",
    'row.author_avatar_user_id',
    'paint(avatar, row.author_avatar_path, avatarOwnerId',
    "el('span', '', row.author_name || 'NOVELIGHT公式')",
    "String(row.author_name || '作').slice(0, 1)"
  ];
  for (const term of terms) {
    assert.ok(ui.includes(term), term);
  }
  assert.ok(!ui.includes(".from('admin_operation_audit')"));
});
