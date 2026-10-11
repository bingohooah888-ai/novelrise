import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const nav = read('novelight-work-navigation.js');
const novelDetail = read('novelight-novel-detail.js');
const migration = read(
  'supabase/migrations/20261011133000_reader_episode_chapter_index.sql'
);
const rollback = read(
  'supabase/rollback/20261011133000_reader_episode_chapter_index_rollback.sql'
);
const precheck = read(
  'supabase/checks/20261011133000_reader_episode_chapter_index_precheck.sql'
);
const postcheck = read(
  'supabase/checks/20261011133000_reader_episode_chapter_index_postcheck.sql'
);

test('missing and broken character images have equal-size initial fallbacks', () => {
  for (const pattern of [
    /if \(!String\(value \|\| ''\)\.trim\(\)\) return '';/u,
    /function characterFallback/u,
    /Array\.from\(String\(row\.name \|\| '人'\)\)\[0\]/u,
    /image\.addEventListener\('error'/u,
    /image\.replaceWith\(characterFallback/u,
    /card\.appendChild\(characterFallback/u,
    /\.nl-worknav-character-placeholder\{display:grid/u,
    /\.nl-worknav-novel-character-placeholder\{display:grid/u
  ]) {
    assert.match(nav, pattern);
  }
  assert.doesNotMatch(nav, /\.nl-worknav-character\.no-image/u);
});

test('chapter index preserves existing title visibility and safe fallback', () => {
  for (const pattern of [
    /novelight_reader_episode_chapter_index/u,
    /result\.error && runtimeMissing\(result\.error\)/u,
    /client\.rpc\('novelight_reader_episode_index'/u,
    /chapterId: row\.chapter_id == null/u,
    /chapterTitle: String\(row\.chapter_title \|\| ''\)/u
  ]) {
    assert.match(nav, pattern);
  }
  for (const pattern of [
    /from public\.novelight_reader_episode_index\(p_novel_ids\)/u,
    /when idx\.episode_title is not null then c\.title/u,
    /and e\.status = 'published'/u,
    /c\.novel_id = e\.novel_id/u,
    /set search_path = ''/u,
    /to anon, authenticated, service_role/u
  ]) {
    assert.match(migration, pattern);
  }
  assert.doesNotMatch(migration, /valid_read_events|update public\./u);
});

test('both reading surfaces offer native chapter folding', () => {
  for (const pattern of [
    /document\.createElement\('details'\)/u,
    /document\.createElement\('summary'\)/u,
    /group\.open = chapterRows\.some/u,
    /visibleTitle \|\| `第\$\{chapterOrdinal\}章`/u,
    /mobileDetails\('話数', makeEpisodeList/u
  ]) {
    assert.match(nav, pattern);
  }
  assert.match(novelDetail, /node\('details', 'nl-work-toc-group'\)/u);
  assert.match(novelDetail, /node\('summary', 'nl-work-toc-chapter'/u);
  assert.match(novelDetail, /installMobileToc\(items, id, actions\)/u);
});

test('migration provides isolated rollback and safe prerequisites', () => {
  assert.match(rollback, /novelight_reader_episode_chapter_index/u);
  assert.match(precheck, /novelight_reader_episode_index/u);
  assert.match(postcheck, /has_function_privilege\('anon'/u);
  assert.match(postcheck, /has_function_privilege\('authenticated'/u);
});
