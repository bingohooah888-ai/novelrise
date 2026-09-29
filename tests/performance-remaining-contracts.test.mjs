import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const between = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return source.slice(from, to);
};

test('mypage author guide keeps initial author data bounded and content-free', async () => {
  const source = await read('mypage.html');
  const guide = between(source, 'async function loadAuthorGuide()', 'async function loadAnalytics()');

  assert.match(guide, /await Promise\.all\(\[/u);
  assert.match(guide, /select\('id,title,status,created_at',\{count:'exact'\}\)/u);
  assert.match(guide, /select\('id,novel_id,status,episode_number,created_at',\{count:'exact'\}\)/u);
  assert.ok((guide.match(/\.limit\(1\)/gu) || []).length >= 3);
  assert.doesNotMatch(guide, /select\(['"]\*['"]\)/u);
  assert.doesNotMatch(guide, /\bcontent\b/u);
});

test('home preserves dependent discovery fallback while parallelizing independent shelves', async () => {
  const source = await read('index.html');
  const discovery = between(source, 'async function loadDiscovery()', 'async function neutralNew(');
  const discoveryAt = discovery.indexOf('await discoveryFeed(');
  const extraAt = discovery.indexOf('await planExtraFeed(');

  assert.ok(discoveryAt >= 0 && extraAt > discoveryAt);
  assert.match(discovery, /p_exclude_novel_ids:excluded/u);
  assert.match(
    source,
    /await Promise\.all\(\[loadDiscovery\(\),loadNewArrivals\(\),loadSeedShelf\(\),loadRankDiscoveryShelves\(\)\]\)/u
  );
});

test('bookshelf bounds initial requests and retains an explicit all-items path', async () => {
  const source = await read('novelight-bookshelf.js');

  assert.match(source, /const BOOKSHELF_INITIAL_LIMIT = 30;/u);
  assert.match(source, /const initialQueryLimit = BOOKSHELF_INITIAL_LIMIT \+ 1;/u);
  assert.match(source, /if \(!loadAll\) favoritesQuery = favoritesQuery\.limit\(initialQueryLimit\);/u);
  assert.match(source, /limit: loadAll \? null : initialQueryLimit/u);
  assert.match(source, /url\.searchParams\.set\('all', '1'\);/u);
  assert.match(source, /本棚をすべて読み込む/u);
});
