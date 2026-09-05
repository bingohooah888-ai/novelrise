import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const css = read('novelight-discovery-list.css');

const discoveryPages = ['recommended.html', 'new-arrivals.html', 'light-seed.html'];

test('reader discovery pages share the parchment stylesheet', () => {
  for (const file of discoveryPages) {
    const html = read(file);
    assert.ok(html.includes('novelight-discovery-list.css'), `${file} should load shared discovery CSS`);
    assert.ok(html.includes('novelight-page-discovery-list'), `${file} should keep discovery-list body scope`);
  }
});

test('search and ranking opt into the shared discovery visual system', () => {
  const search = read('search.html');
  const ranking = read('ranking.html');

  assert.ok(search.includes('novelight-discovery-list.css'));
  assert.ok(search.includes('class="novelight-page-search"'));
  assert.ok(ranking.includes('novelight-discovery-list.css'));
  assert.ok(ranking.includes('class="novelight-page-ranking"'));
});

test('shared CSS preserves the approved parchment and readable type language', () => {
  assert.ok(css.includes('--discovery-paper-1: #f1e5c9'));
  assert.ok(css.includes('--discovery-paper-2: #e6d3ad'));
  assert.ok(css.includes('--discovery-paper-3: #dcc294'));
  assert.ok(css.includes('body.novelight-page-search'));
  assert.ok(css.includes('body.novelight-page-ranking'));
  assert.ok(css.includes('.discovery-list-grid .shelf-card .novel-title'));
  assert.ok(css.includes('font-size: 19px'));
  assert.ok(css.includes('font-size: 17px'));
});
