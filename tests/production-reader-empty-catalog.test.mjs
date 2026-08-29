import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import {
  SEARCH_EMPTY_MESSAGE,
  resolveSearchCatalogState
} from './e2e/production/search-catalog-state.js';

test('production reader accepts a populated search catalog', () => {
  assert.equal(
    resolveSearchCatalogState({
      resultText: '12作品',
      cardCount: 3,
      emptyText: null
    }),
    'populated'
  );
});

test('production reader accepts the official empty search catalog state', () => {
  assert.equal(
    resolveSearchCatalogState({
      resultText: '0作品',
      cardCount: 0,
      emptyText: SEARCH_EMPTY_MESSAGE
    }),
    'empty'
  );
});

test('production reader rejects an empty catalog without the official empty state', () => {
  assert.throws(() =>
    resolveSearchCatalogState({
      resultText: '0作品',
      cardCount: 0,
      emptyText: null
    })
  );
});

test('production reader rejects a positive result count without cards', () => {
  assert.throws(() =>
    resolveSearchCatalogState({
      resultText: '1作品',
      cardCount: 0,
      emptyText: null
    })
  );
});

test('production reader rejects search loading and error states', () => {
  for (const resultText of ['読み込み中...', '読み込みエラー']) {
    assert.throws(() =>
      resolveSearchCatalogState({
        resultText,
        cardCount: 0,
        emptyText: null
      })
    );
  }
});

test('search page empty-state copy stays aligned with production reader smoke', async () => {
  const searchHtml = await readFile(
    new URL('../search.html', import.meta.url),
    'utf8'
  );

  assert.ok(
    searchHtml.includes(`<div class="empty">${SEARCH_EMPTY_MESSAGE}</div>`)
  );
});
