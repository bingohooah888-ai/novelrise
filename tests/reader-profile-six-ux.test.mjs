import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('previous and next episode labels preserve author subtitles without doubled numbering', () => {
  const window = {};
  runInNewContext(read('novelight-episode-title-display.js'), { window });
  const source = read('novelight-reading-continuity.js');
  const start = source.indexOf('  function episodeNavigationTitle(item) {');
  const end = source.indexOf('\n\n  function renderEpisodeNavigation', start);
  assert.ok(start >= 0 && end > start);
  const label = runInNewContext(source.slice(start, end) + '\nepisodeNavigationTitle', { window });
  assert.equal(label({ episode_number: 7, title: '出会い' }), '第7話　出会い');
  assert.equal(label({ episode_number: 7, title: '第7話　出会い' }), '第7話　出会い');
  assert.equal(label({ episode_number: 7, title: '' }), '第7話');
  assert.match(source, /episodeNavigationTitle\(previous\)/u);
  assert.match(source, /episodeNavigationTitle\(next\)/u);
});

test('profile editing warns before losing unsaved text and opens title help separately', () => {
  const page = read('mypage.html');
  const css = read('novelight-author-home.css');
  assert.match(page, /hasUnsavedProfileChanges\(\)/u);
  assert.match(page, /addEventListener\('beforeunload'/u);
  assert.match(page, /rememberSavedProfile\(\);profileReady=true/u);
  assert.match(page, /rememberSavedProfile\(\);st\.textContent='保存しました/u);
  assert.match(page, /scout-record\.html#badgeTitle" target="_blank" rel="noopener noreferrer"/u);
  assert.match(page, /placeholder="表示名を入力"/u);
  assert.match(page, /placeholder="自己紹介を入力"/u);
  assert.match(css, /\.profile-editor \.form input,\.profile-editor \.form textarea/u);
});

test('profile prioritizes author publications and shows one scout title within the record', () => {
  const author = read('author.html');
  const scout = read('novelight-public-scout.js');
  const css = read('novelight-public-scout.css');
  assert.ok(author.indexOf('id="publicScoutRecord"') > author.indexOf('id="list"'));
  assert.match(scout, /<div class="public-scout-label">装備称号<\/div>/u);
  assert.doesNotMatch(scout, /<span>装備称号<\/span><strong>/u);
  assert.match(css, /public-scout-summary\{[^}]*grid-template-columns:repeat\(2,minmax/u);
});

test('public profile resolves official author, normal and hard scout artwork', () => {
  const source = read('novelight-public-scout.js');
  const start = source.indexOf('  const badgeArtworkOverrides = {');
  const end = source.indexOf('\n  function optimizedArtworkPath', start);
  assert.ok(start >= 0 && end > start);
  const artwork = runInNewContext(
    source.slice(start, end) + '\ntitleArtworkPath',
    {}
  );
  assert.equal(artwork({ badge_id: 'author_novel_001' }), 'assets/scout-badges/author_novel_001.png');
  assert.equal(artwork({ badge_id: 'reader_completed_read_005' }), 'assets/scout-badges/reader_completed_read_005.png');
  assert.equal(artwork({ badge_id: 'reader_read_500' }), 'assets/scout-badges/hard_reader_read_500.png');
  assert.equal(artwork({ badge_id: 'limited_founding_author' }), 'assets/founding-authors-badge-2026.png');
  assert.equal(artwork({ badge_id: '../bad.png' }), null);
  assert.match(source, /novelightTriedOriginal/u);
});
