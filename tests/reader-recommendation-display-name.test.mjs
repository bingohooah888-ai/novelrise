import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const files = Object.fromEntries(
  await Promise.all(
    [
      'favorites.html',
      'curation-lists.html',
      'curation.html',
      'novelight-curation.js',
      'novelight-help.js',
      'reader-features.html',
      'novelight-community.js',
      'novelight-bookshelf-overview.css',
      'docs/NOVELIGHT-MASTER.md'
    ].map(async (path) => [path, await readFile(path, 'utf8')])
  )
);

test('reader-visible recommendation lists use the approved name everywhere', () => {
  for (const path of ['favorites.html', 'curation-lists.html', 'curation.html', 'novelight-help.js']) {
    assert.doesNotMatch(files[path], /キュレーション/u, path);
    assert.match(files[path], /おすすめリスト/u, path);
  }
  assert.match(files['favorites.html'], /curation-lists\.html">おすすめリストを管理/u);
  assert.match(files['curation-lists.html'], /<h1>おすすめリスト<\/h1>/u);
  assert.match(files['curation-lists.html'], /＋ おすすめリストに追加/u);
  assert.match(files['curation.html'], /<title>おすすめリスト \| NOVELIGHT<\/title>/u);
  assert.match(files['reader-features.html'], /<h3>おすすめリスト<\/h3>/u);
  assert.match(files['novelight-curation.js'], /＋ おすすめリストに追加/u);
  assert.match(files['novelight-community.js'], /curation:'おすすめリスト'/u);
});

test('stable internal curation links and private/public boundaries remain intact', () => {
  assert.match(files['favorites.html'], /href="curation-lists\.html"/u);
  assert.match(files['novelight-curation.js'], /novelight_manage_my_curation_lists/u);
  assert.match(files['novelight-curation.js'], /new URL\('curation\.html'/u);
  assert.match(files['curation.html'], /name="robots" content="noindex,follow"/u);
  assert.match(files['curation.html'], /name="referrer" content="no-referrer"/u);
  assert.match(files['docs/NOVELIGHT-MASTER.md'], /2026-10-01 OWNER確定の画面表示名称/u);
});

test('all bookshelf LIGHT SEED numeric labels inherit the brand Mincho', () => {
  const css = files['novelight-bookshelf-overview.css'];
  assert.match(css, /\.nl-shelf-seeds\{[^}]*font-family:var\(--novelight-brand-display-font\)/u);
  assert.match(css, /\.nl-shelf-seed-title\{[^}]*font:800 13px\/1\.3 var\(--novelight-brand-display-font\)/u);
  assert.match(css, /\.nl-shelf-seed-title strong\{[^}]*font:900 19px\/1\.2 var\(--novelight-brand-display-font\)/u);
  assert.match(css, /\.nl-shelf-seed strong\{[^}]*font-family:var\(--novelight-brand-display-font\)/u);
  assert.doesNotMatch(css.match(/\.nl-shelf-seed(?:-title)?[^\n]*/gu)?.join('\n') ?? '', /Georgia/u);
});
