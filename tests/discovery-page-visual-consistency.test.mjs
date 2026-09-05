import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const css = read('novelight-discovery-list.css');

const discoveryPages = [
  'recommended.html',
  'new-arrivals.html',
  'light-seed.html'
];

test('discovery pages share visual CSS', () => {
  for (const file of discoveryPages) {
    const html = read(file);
    assert.ok(html.includes('novelight-discovery-list.css'));
    assert.ok(html.includes('novelight-page-discovery-list'));
  }
});

test('search and ranking use shared visual CSS', () => {
  const search = read('search.html');
  const ranking = read('ranking.html');

  assert.ok(search.includes('novelight-discovery-list.css'));
  assert.ok(search.includes('class="novelight-page-search"'));
  assert.ok(ranking.includes('novelight-discovery-list.css'));
  assert.ok(ranking.includes('class="novelight-page-ranking"'));
});

test('shared CSS keeps parchment colors and readable type', () => {
  assert.ok(css.includes('--discovery-paper-1: #f1e5c9'));
  assert.ok(css.includes('--discovery-paper-2: #e6d3ad'));
  assert.ok(css.includes('--discovery-paper-3: #dcc294'));
  assert.ok(
    css.includes(
      'body.novelight-page-discovery-list.novelight-public-dark .discovery-list-copy h1'
    )
  );
  assert.ok(css.includes('color: #20150e'));
  assert.ok(css.includes('font-size: clamp(30px, 4vw, 46px)'));
  assert.ok(css.includes('font-size: clamp(30px, 4vw, 42px)'));
  assert.ok(css.includes('font-size: 21px'));
  assert.ok(css.includes('font-size: 19px'));
  assert.ok(css.includes('font-size: 18px'));
});

test('button typography keeps the approved size', () => {
  assert.ok(css.includes('.discovery-list-tabs a {'));
  assert.ok(css.includes('.discovery-list-more {'));
  assert.ok(css.includes('body.novelight-page-search .more {'));
  assert.ok(css.includes('body.novelight-page-ranking .tab {'));
  assert.ok((css.match(/font-size: 16px/g) || []).length >= 4);
});
