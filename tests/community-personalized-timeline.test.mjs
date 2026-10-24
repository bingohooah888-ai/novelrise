import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

function read(path) {
  return readFileSync(new URL('../' + path, import.meta.url), 'utf8');
}

const migrationPath =
  'supabase/migrations/20261024171000_community_personalized_timeline.sql';
const migration = read(migrationPath);

test('one timeline appears on the homepage and plaza', () => {
  const html = read('community.html');
  const js = read('novelight-community.js');
  const home = read('index.html');
  assert.equal(html.includes('data-community-filter'), false);
  assert.equal(js.includes('data-community-filter'), false);
  assert.equal(js.includes('p_following:requestedFollowing'), false);
  assert.ok(js.includes('novelight_community_feed'));
  assert.ok(home.includes('フォロー・お気に入り作品の更新'));
  assert.doesNotThrow(() => new Function(js));
});

test('new works stay global, episodes require follow or favorite', () => {
  const terms = [
    "SELECT 'novel'::text AS kind",
    "SELECT 'episode'",
    'public.author_follows f',
    'public.favorites fav',
    'fav.novel_id=n.id',
    'f.author_user_id=e.author_user_id',
  ];
  for (const term of terms) {
    assert.ok(migration.includes(term), term);
  }
  assert.equal(migration.includes('WHERE (NOT p_following'), false);
});

test('legacy keys are preserved and new episodes use event IDs', () => {
  const terms = [
    'CREATE TABLE public.community_episode_key_cutover',
    'legacy_max_event_id',
    '1000000000000::bigint + e.id',
    'e.id <=',
    'e.id >',
    '/10800',
  ];
  for (const term of terms) {
    assert.ok(migration.includes(term), term);
  }
  assert.equal(migration.includes('UPDATE public.community_reactions'), false);
  const commentsDeletion = 'DELETE FROM public.community_comments';
  assert.equal(migration.includes(commentsDeletion), false);
});

test('direct access is restricted and moderation remains', () => {
  const terms = [
    'novelight_community_post_visible',
    'novelight_community_post_author',
    'novelight_community_interaction_allowed',
    'fav.user_id=(SELECT auth.uid())',
    'f.follower_user_id=(SELECT auth.uid())',
    'community_hidden_posts',
    'user_blocks',
    'user_mutes',
    'novelight_community_board_visible',
    'official_profile.avatar_path',
    'ENABLE ROW LEVEL SECURITY',
    'REVOKE ALL ON TABLE public.community_episode_key_cutover',
  ];
  for (const term of terms) {
    assert.ok(migration.includes(term), term);
  }
  const unsafeGrant = 'GRANT SELECT ON TABLE public.favorites';
  assert.equal(migration.includes(unsafeGrant), false);
});
