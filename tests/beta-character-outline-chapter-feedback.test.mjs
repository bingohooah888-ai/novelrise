import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const migration = read(
  'supabase/migrations/20261001080000_beta_feedback_character_outline_chapters.sql'
);
const refreshMigration = read(
  'supabase/migrations/20261001081500_character_first_appearance_refresh.sql'
);
const charactersPage = read('characters.html');
const charactersJs = read('novelight-characters.js');
const episodePost = read('episode-post.html');
const structurePage = read('episode-structure.html');

const publicOutlineTitles =
  /select\s+e\.id,\s+e\.title,\s+e\.episode_number,\s+e\.status,\s+c\.id,\s+c\.title/s;
const metadataRpc =
  /create or replace function public\.novelight_update_novel_structure_metadata[\s\S]*?end\n\$\$;/;

test('first appearance limits auto detection', () => {
  assert.match(migration, /add column first_appearance_episode_id bigint/);
  assert.match(migration, /e\.episode_number >= first_episode\.episode_number/);
  assert.match(
    refreshMigration,
    /new\.episode_number >= first_episode\.episode_number/
  );
  assert.match(migration, /first_appearance_episode_id is null/);
});

test('manual character overrides remain available', () => {
  assert.match(charactersJs, /手動で含める/);
  assert.match(charactersJs, /手動で除外/);
  assert.match(charactersJs, /p_override_mode: select\.value/);
});

test('character management selects a first episode', () => {
  assert.match(charactersPage, /id="firstAppearance"/);
  assert.match(charactersPage, /初登場話/);
  assert.match(charactersPage, /漢字1文字/);
  assert.match(charactersPage, /novelight_upsert_character_v2/);
  assert.match(charactersPage, /p_first_appearance_episode_id/);
});

test('new episode posting reuses the shared character editor', () => {
  assert.match(episodePost, /id="openCharacterSettings"[^>]*>登場人物/);
  assert.match(episodePost, /p_episode_id:pendingDraftId/);
  assert.match(episodePost, /pendingDraftId=draftId/);
  assert.match(episodePost, /persistDraft\(values\)/);
  assert.match(episodePost, /NovelightCharacters\?\.mountEpisodeEditor/);
  assert.match(episodePost, /episodeId:draftId/);
  assert.match(episodePost, /mountTarget:postCharacterEditor/);
});

test('character effective state has text and visual treatment', () => {
  assert.match(charactersJs, /is-effective/);
  assert.match(charactersJs, /is-inactive/);
  assert.match(charactersJs, /反映中/);
  assert.match(charactersJs, /未反映/);
  assert.match(charactersJs, /\.novelight-character-editor-row\.is-effective/);
  assert.match(charactersJs, /border-left/);
});

test('public outline titles stay inside the published boundary', () => {
  assert.match(
    migration,
    /v_novel_status = 'published' and e\.status = 'published'/
  );
  assert.match(migration, publicOutlineTitles);
  assert.doesNotMatch(migration, /novelight_reader_episode_index/);
  assert.doesNotMatch(migration, /novelight_character_feed/);
});

test('chapter metadata save never renumbers episodes', () => {
  const metadataFunction = migration.match(metadataRpc)?.[0];
  assert.ok(metadataFunction, 'metadata-only RPC must exist');
  assert.doesNotMatch(metadataFunction, /set episode_number/);
  assert.match(metadataFunction, /set chapter_id = desired\.chapter_id/);
  assert.match(structurePage, /novelight_update_novel_structure_metadata/);
  assert.match(structurePage, /episodeOrderDirty/);
});

test('bulk chapter assignment preserves array order', () => {
  assert.match(structurePage, /bulkChapter/);
  assert.match(structurePage, /selectedEpisodeIds/);
});
