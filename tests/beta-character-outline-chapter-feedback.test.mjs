import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const migration = read(
  'supabase/migrations/20261001080000_beta_feedback_character_outline_chapters.sql'
);
const refreshMigration = read(
  'supabase/migrations/20261001081500_character_first_appearance_refresh.sql'
);
const charactersPage = read('characters.html');
const charactersJs = read('novelight-characters.js');
const charactersCss = read('novelight-characters.css');
const authorTools = read('novelight-episode-author-tools.js');
const structurePage = read('episode-structure.html');

test('A-C: first-appearance boundary is enforced while manual overrides remain authoritative', () => {
  assert.match(migration, /add column first_appearance_episode_id bigint/);
  assert.match(
    migration,
    /e\.episode_number >= first_episode\.episode_number/
  );
  assert.match(
    refreshMigration,
    /new\.episode_number >= first_episode\.episode_number/
  );
  assert.match(
    charactersJs,
    /when s\.override_mode = 'include' then true|手動で含める/
  );
  assert.match(charactersJs, /手動で除外/);
  assert.match(charactersJs, /p_override_mode: select\.value/);
});

test('character management exposes an episode selector and preserves unset backward compatibility', () => {
  assert.match(charactersPage, /id="firstAppearance"/);
  assert.match(charactersPage, /初登場話/);
  assert.match(charactersPage, /漢字1文字/);
  assert.match(charactersPage, /novelight_upsert_character_v2/);
  assert.match(charactersPage, /p_first_appearance_episode_id/);
  assert.match(migration, /first_appearance_episode_id is null/);
});

test('D: new episode posting reuses the existing draft flow before mounting the shared character editor', () => {
  assert.match(authorTools, /登場人物/);
  assert.match(authorTools, /persistDraft\(values\)/);
  assert.match(authorTools, /pendingDraftId/);
  assert.match(authorTools, /NovelightCharacters\.mountEpisodeEditor/);
  assert.match(authorTools, /mountTarget: characterMount/);
});

test('E: effective character state is available as text and a non-color-only visual treatment', () => {
  assert.match(charactersJs, /is-effective/);
  assert.match(charactersJs, /is-inactive/);
  assert.match(charactersJs, /反映中/);
  assert.match(charactersJs, /未反映/);
  assert.match(charactersCss, /\.novelight-character-editor-row\.is-effective/);
  assert.match(charactersCss, /border-left/);
});

test('F-G: normal outline reveals titles only for public episodes while other spoiler-safe RPCs are not replaced', () => {
  assert.match(
    migration,
    /v_novel_status = 'published' and e\.status = 'published'/
  );
  assert.match(
    migration,
    /select\s+e\.id,\s+e\.title,\s+e\.episode_number,\s+e\.status,\s+c\.id,\s+c\.title/s
  );
  assert.doesNotMatch(migration, /create or replace function public\.novelight_reader_episode_index/);
  assert.doesNotMatch(migration, /create or replace function public\.novelight_character_feed/);
});

test('H-I: chapter-only and bulk chapter changes use metadata save path without episode renumbering', () => {
  const metadataFunction = migration.match(
    /create or replace function public\.novelight_update_novel_structure_metadata[\s\S]*?end\n\$\$;/
  )?.[0];
  assert.ok(metadataFunction, 'metadata-only RPC must exist');
  assert.doesNotMatch(metadataFunction, /set episode_number/);
  assert.match(metadataFunction, /set chapter_id = desired\.chapter_id/);
  assert.match(structurePage, /novelight_update_novel_structure_metadata/);
  assert.match(structurePage, /episodeOrderDirty/);
  assert.match(structurePage, /bulkChapter/);
  assert.match(structurePage, /selectedEpisodeIds/);
});
