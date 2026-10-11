import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const nav = read('novelight-work-navigation.js');
const novelDetail = read('novelight-novel-detail.js');
const migration = read('supabase/migrations/20261011133000_reader_episode_chapter_index.sql');
const rollback = read('supabase/rollback/20261011133000_reader_episode_chapter_index_rollback.sql');
const precheck = read('supabase/checks/20261011133000_reader_episode_chapter_index_precheck.sql');
const postcheck = read('supabase/checks/20261011133000_reader_episode_chapter_index_postcheck.sql');

test('missing or broken character images keep a consistent image column and fallback initial', () => {
  assert.match(nav, /if \(!String\(value \|\| ''\)\.trim\(\)\) return '';/u);
  assert.match(nav, /function characterFallback\(row, \{ episode = false \} = \{\}\)/u);
  assert.match(nav, /Array\.from\(String\(row\.name \|\| '人'\)\)\[0\]/u);
  assert.match(nav, /image\.addEventListener\('error', \(\) => \{/u);
  assert.match(nav, /image\.replaceWith\(characterFallback\(row, \{ episode \}\)\)/u);
  assert.match(nav, /else \{\s+card\.appendChild\(characterFallback\(row, \{ episode \}\)\);/u);
  assert.match(nav, /\.nl-worknav-character-placeholder\{display:grid/u);
  assert.match(nav, /\.nl-worknav-novel-character-placeholder\{display:grid/u);
  assert.doesNotMatch(nav, /\.nl-worknav-character\.no-image|\.nl-worknav-novel-character\.no-image/u);
});

test('reader episode index uses a versioned spoiler-safe RPC and legacy fallback', () => {
  assert.match(nav, /client\.rpc\('novelight_reader_episode_chapter_index', params\)/u);
  assert.match(nav, /result\.error && runtimeMissing\(result\.error\)/u);
  assert.match(nav, /client\.rpc\('novelight_reader_episode_index', params\)/u);
  assert.match(nav, /chapterId: row\.chapter_id == null \? null : String\(row\.chapter_id\)/u);
  assert.match(nav, /chapterTitle: String\(row\.chapter_title \|\| ''\)/u);
  assert.match(migration, /from public\.novelight_reader_episode_index\(p_novel_ids\) as idx/u);
  assert.match(migration, /when idx\.episode_title is not null then c\.title/u);
  assert.match(migration, /and e\.status = 'published'/u);
  assert.match(migration, /c\.novel_id = e\.novel_id/u);
  assert.match(migration, /set search_path = ''/u);
  assert.match(migration, /to anon, authenticated, service_role/u);
  assert.doesNotMatch(migration, /valid_read_events|set episode_number|update public\./u);
});

test('chapter groups are keyboard-operable on episode page and on novel detail', () => {
  assert.match(nav, /document\.createElement\('details'\)/u);
  assert.match(nav, /document\.createElement\('summary'\)/u);
  assert.match(nav, /group\.open = chapterRows\.some/u);
  assert.match(nav, /visibleTitle \|\| `第\$\{chapterOrdinal\}章`/u);
  assert.match(nav, /if \(!chapterId\) \{/u);
  assert.match(novelDetail, /node\('details', 'nl-work-toc-group'\)/u);
  assert.match(novelDetail, /node\('summary', 'nl-work-toc-chapter'/u);
  assert.match(novelDetail, /installMobileToc\(items, id, actions\)/u);
  assert.match(nav, /mobileDetails\('話数', makeEpisodeList/u);
});

test('migration has reversible and fail-closed SQL checks', () => {
  assert.match(rollback, /drop function if exists public\.novelight_reader_episode_chapter_index\(text\[\]\)/u);
  assert.match(precheck, /novelight_reader_episode_index\(text\[\]\)/u);
  assert.match(postcheck, /has_function_privilege\('anon'/u);
  assert.match(postcheck, /has_function_privilege\('authenticated'/u);
});
