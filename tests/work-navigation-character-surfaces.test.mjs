import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [
  episode,
  novel,
  novelEdit,
  navigation,
  characterAdmin,
  authorBackgrounds,
  migration,
] = await Promise.all([
  readFile('episode.html', 'utf8'),
  readFile('novel.html', 'utf8'),
  readFile('novel-edit.html', 'utf8'),
  readFile('novelight-work-navigation.js', 'utf8'),
  readFile('novelight-character-surface-admin.js', 'utf8'),
  readFile('novelight-author-backgrounds.js', 'utf8'),
  readFile(
    'supabase/migrations/20261005171000_work_navigation_character_surfaces.sql',
    'utf8',
  ),
]);

test('episode reader uses one integrated navigation surface on desktop and mobile', () => {
  assert.match(episode, /novelight-work-navigation\.js/u);
  assert.match(
    episode,
    /NovelightWorkNavigation\.mountEpisode\(\{client,episode,novel\}\)/u,
  );
  assert.doesNotMatch(episode, /NovelightCharacters\.mountReader/u);
  assert.match(navigation, /nl-worknav-support/u);
  assert.match(navigation, /nl-worknav-mobile/u);
  assert.match(navigation, /mobileDetails\('話数'/u);
  assert.match(navigation, /mobileDetails\('登場人物'/u);
  assert.match(navigation, /novelight_reader_episode_index/u);
});

test('novel detail exposes continue CTA and compact spoiler-safe characters', () => {
  assert.match(novel, /novelight-work-navigation\.js/u);
  assert.match(
    novel,
    /NovelightWorkNavigation\.mountNovel\(\{client,novelId:novel\.id\}\)/u,
  );
  assert.match(navigation, /第1話から読む/u);
  assert.match(navigation, /続きを読む/u);
  assert.match(navigation, /もっと見る/u);
  assert.match(navigation, /novelight_novel_character_feed/u);
});

test('author editing exposes the shared character management entry and surface controls', () => {
  assert.match(novelEdit, /id="manageCharacters"/u);
  assert.match(novelEdit, /characters\.html\?novel_id=/u);
  assert.match(authorBackgrounds, /novelight-character-surface-admin\.js/u);
  assert.match(characterAdmin, /readerBodyVisible/u);
  assert.match(characterAdmin, /novelDetailVisible/u);
  assert.match(characterAdmin, /displayOrder/u);
  assert.match(characterAdmin, /novelight_upsert_character_v4/u);
  assert.match(characterAdmin, /p_reader_body_visible/u);
  assert.match(characterAdmin, /p_novel_detail_visible/u);
  assert.match(characterAdmin, /p_display_order/u);
});

test('new character reader surfaces are opt-in for existing rows', () => {
  assert.match(
    migration,
    /reader_body_visible boolean not null default false/u,
  );
  assert.match(
    migration,
    /novel_detail_visible boolean not null default false/u,
  );
  assert.match(migration, /display_order integer not null default 0/u);
  assert.match(
    migration,
    /grant execute on function public\.novelight_upsert_character_v4[\s\S]*?to authenticated;/u,
  );
});

test('episode character feed is publication and first-appearance bounded', () => {
  const start = migration.indexOf(
    'create or replace function public.novelight_character_feed',
  );
  const end = migration.indexOf(
    'create or replace function public.novelight_novel_character_feed',
    start,
  );
  const feed = migration.slice(start, end);
  assert.match(feed, /c\.reader_visible/u);
  assert.match(feed, /c\.reader_body_visible/u);
  assert.match(feed, /e\.status = 'published'/u);
  assert.match(feed, /e\.episode_number <= v_current_number/u);
  assert.match(
    feed,
    /first_episode\.episode_number <= v_current_number/u,
  );
  assert.doesNotMatch(feed, /'aliases'/u);
});

test('novel-detail character feed never reveals beyond valid-read progress', () => {
  const start = migration.indexOf(
    'create or replace function public.novelight_novel_character_feed',
  );
  const end = migration.indexOf(
    'revoke all on function public.novelight_novel_character_feed',
    start,
  );
  const feed = migration.slice(start, end);
  assert.match(feed, /c\.reader_visible/u);
  assert.match(feed, /c\.novel_detail_visible/u);
  assert.match(feed, /public\.valid_read_events/u);
  assert.match(feed, /vr\.reader_id = v_uid/u);
  assert.match(feed, /e\.status = 'published'/u);
  assert.match(
    feed,
    /q\.first_appearance_episode_number <= v_reveal_through/u,
  );
  assert.doesNotMatch(feed, /'aliases'/u);
});
