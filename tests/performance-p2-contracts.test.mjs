import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { URL } from 'node:url';

const read = (path) =>
  fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('mypage author guide bounds initial author-data rows', () => {
  const source = read('mypage.html');
  assert.ok(
    source.includes("select('id,title,status,created_at',{count:'exact'})")
  );
  assert.ok(
    source.includes(
      ".eq('status','published').order('created_at',{ascending:false}).limit(1)"
    )
  );
  assert.ok(
    source.includes(
      ".eq('status','draft').order('created_at',{ascending:false}).limit(1)"
    )
  );
});

test('home starts independent discovery shelves together', () => {
  const source = read('index.html');
  assert.ok(
    source.includes(
      'Promise.all([loadDiscovery(),loadNewArrivals(),loadSeedShelf(),loadRankDiscoveryShelves()])'
    )
  );
});

test('bookshelf bounds initial fetch and retains an explicit all-items path', () => {
  const source = read('novelight-bookshelf.js');
  assert.ok(source.includes('BOOKSHELF_INITIAL_LIMIT = 30'));
  assert.ok(source.includes('BOOKSHELF_INITIAL_LIMIT + 1'));
  assert.ok(source.includes("url.searchParams.set('all', '1')"));
});

test('updates page pages favorite scans before episode-index lookup', () => {
  const source = read('novelight-favorite-updates.js');
  assert.ok(source.includes('FAVORITE_UPDATE_PAGE_SIZE = 20'));
  assert.ok(source.includes('favoritesQuery.range(start, start + limit)'));
  assert.ok(source.includes('limit: FAVORITE_UPDATE_PAGE_SIZE'));
  assert.ok(source.includes('nextOffset'));
});
