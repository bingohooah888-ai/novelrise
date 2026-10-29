import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const paths = [
  'favorites.html',
  'curation-lists.html',
  'curation.html',
  'novelight-curation.js',
  'novelight-help.js',
  'reader-features.html',
  'novelight-community.js',
  'novelight-bookshelf-overview.css',
];
const files = {};
for (const path of paths) {
  files[path] = await readFile(path, 'utf8');
}

test('approved recommendation list name is used on reader pages', () => {
  const pages = [
    'favorites.html',
    'curation-lists.html',
    'curation.html',
    'novelight-help.js',
  ];
  for (const path of pages) {
    assert.doesNotMatch(files[path], /キュレーション/u, path);
    assert.match(files[path], /おすすめリスト/u, path);
  }
  assert.match(files['favorites.html'], /おすすめリストを管理/u);
  assert.match(files['curation-lists.html'], /<h1>おすすめリスト<\/h1>/u);
  assert.match(files['curation-lists.html'], /＋ おすすめリストに追加/u);
  assert.match(files['curation.html'], /<title>おすすめリスト/u);
  assert.match(files['reader-features.html'], /<h3>おすすめリスト<\/h3>/u);
  assert.match(files['novelight-curation.js'], /＋ おすすめリストに追加/u);
  assert.match(files['novelight-community.js'], /curation:'おすすめリスト'/u);
});

test('internal curation routes and sharing safety stay unchanged', () => {
  assert.match(files['favorites.html'], /href="curation-lists\.html"/u);
  assert.match(files['novelight-curation.js'], /novelight_manage_my_curation_lists/u);
  assert.match(files['novelight-curation.js'], /curation\.html/u);
  assert.match(files['curation.html'], /noindex,follow/u);
  assert.match(files['curation.html'], /no-referrer/u);
});

test('all bookshelf seed totals use NOVELIGHT Mincho', () => {
  const css = files['novelight-bookshelf-overview.css'];
  const seedCss = css.split('.nl-shelf-actions-layout{')[0];
  for (const selector of [
    '.nl-shelf-seeds{',
    '.nl-shelf-seed-title{',
    '.nl-shelf-seed-title strong{',
    '.nl-shelf-seed b{',
    '.nl-shelf-seed strong{',
  ]) {
    const start = seedCss.indexOf(selector);
    assert.ok(start >= 0, selector);
    const rule = seedCss.slice(start, seedCss.indexOf('}', start));
    assert.match(rule, /var\(--novelight-brand-display-font\)/u, selector);
  }
  assert.doesNotMatch(seedCss, /Georgia/u);
});
