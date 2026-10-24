import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) =>
  readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const migrationPath =
  'supabase/migrations/20261024134500_community_public_profile_avatars.sql';

test('feed adds avatars to the existing privacy-filtered rows', () => {
  const sql = read(migrationPath);
  for (const term of [
    "'author_avatar_path'",
    'p.avatar_path AS author_avatar_path',
    "p.kind='official' THEN NULL",
    'community_runtime_control',
    'community_hidden_posts',
    'user_blocks',
    'user_mutes',
    'content_rating',
    'p_limit',
    'p_offset'
  ]) {
    assert.ok(sql.includes(term), term);
  }
  assert.ok(!sql.includes('GRANT SELECT ON TABLE public.profiles'));
});

test('public author avatar lookup is limited to visible authors', () => {
  const sql = read(migrationPath);
  for (const term of [
    'novelight_public_author_avatar(p_user_id uuid)',
    'p.id = (SELECT auth.uid())',
    "n.status = 'published'",
    "n.content_rating IN ('general','sensitive_15')",
    'REVOKE ALL ON FUNCTION public.novelight_public_author_avatar',
    'GRANT EXECUTE ON FUNCTION public.novelight_public_author_avatar'
  ]) {
    assert.ok(sql.includes(term), term);
  }
});

test('all three public screens reuse the same safe avatar painter', () => {
  for (const page of ['index.html', 'community.html', 'author.html']) {
    assert.ok(read(page).includes('novelight-public-avatar.js'), page);
  }
  const script = read('novelight-public-avatar.js');
  for (const term of [
    'ownedPathPattern',
    'match[1].toLowerCase() !== owner',
    'author-avatars',
    'image.onerror',
    'holder.replaceChildren(fallback)'
  ]) {
    assert.ok(script.includes(term), term);
  }
  assert.ok(read('novelight-community.js').includes('row.author_avatar_path'));
  assert.ok(read('author.html').includes('novelight_public_author_avatar'));
  assert.ok(!read('novelight-community.js').includes(".from('profiles')"));
});

test('the existing owner-only avatar editing contract remains intact', () => {
  const editor = read('novelight-profile-settings.js');
  assert.ok(editor.includes('author-avatars'));
  assert.ok(editor.includes('novelight_update_my_public_profile'));
});
