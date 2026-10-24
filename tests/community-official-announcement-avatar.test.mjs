import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20261024141500_community_official_announcement_owner_avatar.sql');

test('official avatars use original trusted announcement creator and current profile icon', () => {
  for (const token of [
    "audit.action='announcement.create'",
    "audit.resource_type='announcement'",
    "audit.resource_id=split_part(a.post_key, ':', 2)",
    'ORDER BY audit.id ASC',
    'official_profile.avatar_path',
    'official_profile.id',
    "'author_avatar_user_id',p.author_avatar_user_id"
  ]) assert.ok(migration.includes(token), token);
  assert.ok(!migration.includes('GRANT SELECT ON TABLE public.admin_operation_audit'));
  assert.ok(!migration.includes('GRANT SELECT ON TABLE public.profiles'));
  assert.ok(!migration.includes('UPDATE public.announcements'));
});

test('official brand, existing public gate, moderation, and read grants remain unchanged', () => {
  for (const token of [
    'community_runtime_control',
    'community_hidden_posts',
    'user_blocks',
    'user_mutes',
    "a.status='published'",
    "CASE WHEN p.kind='official' THEN 'NOVELIGHT公式'",
    'REVOKE ALL ON FUNCTION public.novelight_community_feed',
    'GRANT EXECUTE ON FUNCTION public.novelight_community_feed'
  ]) assert.ok(migration.includes(token), token);
  assert.ok(migration.includes("SELECT 'official', 'official:' || a.id::text,\n           NULL::uuid"));
});

test('shared avatar painter renders official owner while N fallback and brand label persist', () => {
  const ui = read('novelight-community.js');
  assert.ok(ui.includes("row.kind === 'official'"));
  assert.ok(ui.includes('row.author_avatar_user_id'));
  assert.ok(ui.includes('paint(avatar, row.author_avatar_path, avatarOwnerId'));
  assert.ok(ui.includes("el('span', '', row.author_name || 'NOVELIGHT公式')"));
  assert.ok(ui.includes("String(row.author_name || '作').slice(0, 1)"));
  assert.ok(!ui.includes(".from('admin_operation_audit')"));
});
