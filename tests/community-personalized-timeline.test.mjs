import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) =>
  readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const migration = read(
  'supabase/migrations/20261024171000_community_personalized_timeline.sql',
);

test('one timeline for the homepage and plaza', () => {
  const community = read('community.html');
  const js = read('novelight-community.js');
  const home = read('index.html');
  assert.doesNotMatch(community, /data-community-filter=/);
  assert.doesNotMatch(js, /data-community-filter/);
  assert.doesNotMatch(js, /p_following:requestedFollowing/);
  assert.match(js, /novelight_community_feed/);
  assert.match(home, /フォロー・お気に入り作品の更新/);
  assert.doesNotThrow(() => new Function(js));
});

test('global new works and personalized episode eligibility', () => {
  const section = migration.split(
    'CREATE OR REPLACE FUNCTION public.novelight_community_feed',
  )[1];
  assert.ok(section, 'feed RPC must be replaced');
  assert.match(section, /SELECT 'novel'::text AS kind/);
  assert.match(section, /SELECT 'episode'/);
  assert.match(section, /public\.author_follows f/);
  assert.match(section, /public\.favorites fav/);
  assert.match(section, /fav\.novel_id=n\.id/);
  assert.match(section, /f\.author_user_id=e\.author_user_id/);
  assert.doesNotMatch(section, /WHERE \(NOT p_following OR EXISTS/);
});

test('historical post keys remain intact, new episodes use event keys', () => {
  assert.match(
    migration,
    /CREATE TABLE public\.community_episode_key_cutover/,
  );
  assert.match(
    migration,
    /COALESCE\(MAX\(id\),0\)::bigint FROM public\.author_follow_events/,
  );
  assert.match(migration, /e\.id <= \(SELECT legacy_max_event_id/);
  assert.match(migration, /e\.id > \(SELECT legacy_max_event_id/);
  assert.match(migration, /1000000000000::bigint \+ e\.id/);
  assert.match(
    migration,
    /floor\(extract\(epoch FROM e\.occurred_at\)\/10800\)/,
  );
  assert.doesNotMatch(
    migration,
    /UPDATE public\.community_(?:reactions|comments|reports)/,
  );
  assert.doesNotMatch(
    migration,
    /DELETE FROM public\.community_(?:reactions|comments|reports)/,
  );
});

test('direct interactions enforce scope and retain moderation', () => {
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.novelight_community_post_visible/,
  );
  assert.match(migration, /fav\.user_id=\(SELECT auth\.uid\(\)\)/);
  assert.match(migration, /f\.follower_user_id=\(SELECT auth\.uid\(\)\)/);
  assert.match(migration, /community_hidden_posts/);
  assert.match(migration, /user_blocks/);
  assert.match(migration, /user_mutes/);
  assert.match(migration, /novelight_community_board_visible/);
  assert.match(migration, /official_profile\.avatar_path/);
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.novelight_community_post_author/,
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.novelight_community_interaction_allowed/,
  );
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.community_episode_key_cutover FROM PUBLIC,anon,authenticated/,
  );
  assert.doesNotMatch(
    migration,
    /GRANT SELECT ON TABLE public\.(?:favorites|author_follows)/,
  );
});
