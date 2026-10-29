import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const novelDetailV2 = await readFile('novelight-novel-detail.js', 'utf8');

const [
  episode,
  novel,
  novelEdit,
  navigation,
  characterAdmin,
  authorBackgrounds,
  migration
] = await Promise.all([
  readFile('episode.html', 'utf8'),
  readFile('novel.html', 'utf8'),
  readFile('novel-edit.html', 'utf8'),
  readFile('novelight-work-navigation.js', 'utf8'),
  readFile('novelight-character-surface-admin.js', 'utf8'),
  readFile('novelight-author-backgrounds.js', 'utf8'),
  readFile(
    'supabase/migrations/20261005171000_work_navigation_character_surfaces.sql',
    'utf8'
  )
]);

test('episode reader uses one integrated navigation surface on desktop and mobile', () => {
  assert.match(episode, /novelight-work-navigation\.js/u);
  assert.match(
    episode,
    /NovelightWorkNavigation\.mountEpisode\(\{client,episode,novel\}\)/u
  );
  assert.doesNotMatch(episode, /NovelightCharacters\.mountReader/u);
  assert.match(navigation, /nl-worknav-support/u);
  assert.match(navigation, /nl-worknav-mobile/u);
  assert.match(navigation, /mobileDetails\('話数'/u);
  assert.match(navigation, /mobileDetails\('登場人物'/u);
  assert.match(navigation, /novelight_reader_episode_index/u);
});

test('current episode characters are highlighted and sorted first', () => {
  assert.match(navigation, /function prioritizeCurrentEpisodeCharacters/u);
  assert.match(navigation, /Number\(b\.appears_current_episode === true\)/u);
  assert.match(navigation, /Number\(a\.appears_current_episode === true\)/u);
  assert.match(
    navigation,
    /prioritizeCurrentEpisodeCharacters\(Array\.isArray/u
  );
  assert.match(navigation, /card\.classList\.add\('is-current-episode'\)/u);
  assert.match(
    navigation,
    /\.nl-worknav-character\.is-current-episode\{background:/u
  );
  assert.match(navigation, /client\.rpc\('novelight_character_feed'/u);
});

test('novel detail V2 keeps reading, chapter navigation and spoiler-safe characters without duplicate card', () => {
  assert.match(novel, /novelight-novel-detail\.js/u);
  assert.doesNotMatch(novel, /NovelightWorkNavigation\.mountNovel\(/u);
  assert.match(novelDetailV2, /nl-work-read-action/u);
  assert.match(novelDetailV2, /nl-work-detail-toc/u);
  assert.match(novelDetailV2, /installMobileToc/u);
  assert.match(novelDetailV2, /renderCharacters/u);
  assert.match(novelDetailV2, /novelight_character_feed/u);
  assert.match(novelDetailV2, /nlNovelWorkNav/u);
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

test('hidden reader characters keep author-managed display order editable', () => {
  const syncSurface = characterAdmin.match(
    /function syncSurfaceEnabled\(\) \{([\s\S]*?)\n  \}/u
  )?.[1];
  assert.ok(syncSurface);
  assert.match(syncSurface, /if \(body\) body\.disabled = disabled;/u);
  assert.match(syncSurface, /if \(detail\) detail\.disabled = disabled;/u);
  assert.match(syncSurface, /if \(order\) order\.disabled = false;/u);
  assert.match(characterAdmin, /p_display_order: orderValue/u);
});

test('new character reader surfaces are opt-in for existing rows', () => {
  assert.match(
    migration,
    /reader_body_visible boolean not null default false/u
  );
  assert.match(
    migration,
    /novel_detail_visible boolean not null default false/u
  );
  assert.match(migration, /display_order integer not null default 0/u);
  assert.match(
    migration,
    /grant execute on function public\.novelight_upsert_character_v4[\s\S]*?to authenticated;/u
  );
});

test('episode character feed is publication and first-appearance bounded', () => {
  const start = migration.indexOf(
    'create or replace function public.novelight_character_feed'
  );
  const end = migration.indexOf(
    'create or replace function public.novelight_novel_character_feed',
    start
  );
  const feed = migration.slice(start, end);
  assert.match(feed, /c\.reader_visible/u);
  assert.match(feed, /c\.reader_body_visible/u);
  assert.match(feed, /e\.status = 'published'/u);
  assert.match(feed, /e\.episode_number <= v_current_number/u);
  assert.match(feed, /first_episode\.episode_number <= v_current_number/u);
  assert.doesNotMatch(feed, /'aliases'/u);
});

test('novel-detail character feed never reveals beyond valid-read progress', () => {
  const start = migration.indexOf(
    'create or replace function public.novelight_novel_character_feed'
  );
  const end = migration.indexOf(
    'revoke all on function public.novelight_novel_character_feed',
    start
  );
  const feed = migration.slice(start, end);
  assert.match(feed, /c\.reader_visible/u);
  assert.match(feed, /c\.novel_detail_visible/u);
  assert.match(feed, /public\.valid_read_events/u);
  assert.match(feed, /vr\.reader_id = v_uid/u);
  assert.match(feed, /e\.status = 'published'/u);
  assert.match(feed, /q\.first_appearance_episode_number <= v_reveal_through/u);
  assert.doesNotMatch(feed, /'aliases'/u);
});
