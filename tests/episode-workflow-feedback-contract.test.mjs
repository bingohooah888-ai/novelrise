import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('per-episode automatic number visibility is backward compatible', () => {
  const migration = read(
    'supabase/migrations/20261004103000_add_episode_number_visibility_per_episode.sql',
  );

  assert.match(
    migration,
    /add column if not exists show_episode_number boolean/i,
  );
  assert.match(
    migration,
    /update public\.episodes\s+set show_episode_number = true\s+where show_episode_number is null/i,
  );
  assert.match(migration, /show_episode_number set default true/i);
  assert.match(migration, /show_episode_number set not null/i);
});

test('author editor makes draft autosave, direct publish and draft navigation explicit', () => {
  const source = read('novelight-episode-workflow-feedback.js');

  assert.match(source, /下書きに自動保存済み/);
  assert.match(source, /入力内容は下書きに自動保存されます/);
  assert.match(source, /下書き一覧/);
  assert.match(source, /episode-drafts\.html\?novel_id=/);
  assert.match(source, /今すぐ公開/);
  assert.match(source, /dataset\.publishNowFromSchedule/);
  assert.match(source, /show_episode_number/);
  assert.match(source, /幕間・人物紹介・設定資料/);
});

test('post and edit editors load the shared workflow enhancement', () => {
  const visibilityRuntime = read('novelight-episode-number-entry-visibility.js');
  const post = read('episode-post.html');
  const edit = read('episode-edit.html');

  assert.match(visibilityRuntime, /novelight-episode-workflow-feedback\.js/);
  assert.match(visibilityRuntime, /episode-post\.html/);
  assert.match(visibilityRuntime, /episode-edit\.html/);
  assert.match(post, /novelight-characters\.js/);
  assert.match(edit, /novelight-characters\.js/);
});

test('draft manager supports chapter changes, draft reorder and direct publish', () => {
  const source = read('episode-drafts.html');

  assert.match(source, /data-chapter-id/);
  assert.match(source, /update\(\{chapter_id:chapterId\}\)/);
  assert.match(source, /data-move-id/);
  assert.match(source, /↑ 上へ/);
  assert.match(source, /↓ 下へ/);
  assert.match(source, /novelight_reorder_novel_structure/);
  assert.match(source, /p_episode_items:episodeItems/);
  assert.match(source, /show_episode_number/);
  assert.match(source, /今すぐ公開/);
  assert.match(source, /novelight_publish_episode_draft_atomic/);
});

test('schedule manager offers immediate publish without draft round-trip', () => {
  const source = read('episode-schedule.html');

  assert.match(source, /今すぐ公開/);
  assert.match(source, /data-publish-now/);
  assert.match(source, /novelight_publish_episode_draft_atomic/);
  assert.match(source, /episode-drafts\.html\?novel_id=/);
});

test('reader runtime hides automatic number on only the opted-out entry', () => {
  const source = read('novelight-episode-number-entry-visibility.js');
  const novelLoader = read('novelight-series.js');
  const episodeLoader = read('novelight-characters.js');

  assert.match(source, /select\('id,novel_id,show_episode_number'\)/);
  assert.match(source, /select\('id,show_episode_number'\)/);
  assert.match(source, /novelight-entry-number-hidden/);
  assert.match(source, /show_episode_number === false/);
  assert.match(source, /applyReadingNavigationLabels/);
  assert.match(source, /前のエピソード/);
  assert.match(source, /次のエピソード/);
  assert.match(novelLoader, /novelight-episode-number-entry-visibility\.js/);
  assert.match(episodeLoader, /novelight-episode-number-entry-visibility\.js/);
});