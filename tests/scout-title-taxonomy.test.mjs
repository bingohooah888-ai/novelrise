import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const taxonomy = await readFile('novelight-scout-taxonomy.js', 'utf8');
const scout = await readFile('scout-record.html', 'utf8');
const scoutJs = await readFile('novelight-scout-record.js', 'utf8');
const publicScout = await readFile('novelight-public-scout.js', 'utf8');
const author = await readFile('author.html', 'utf8');
const mypage = await readFile('mypage.html', 'utf8');
const episodePost = await readFile('episode-post.html', 'utf8');
const adminScout = await readFile('admin-scout.html', 'utf8');
const betaAuthors = await readFile('beta-authors.html', 'utf8');

test('canonical Scout Rank and work Rank names are complete and ordered', () => {
  const scoutRanks = [
    'NOCTIS',
    'VESPER',
    'UMBRA',
    'ASTRA',
    'LUCENT',
    'AURELIS',
    'CELESTIA',
    'EMPYREAN',
    'SERAPH',
    'LUMINARIS'
  ];
  const positions = scoutRanks.map((name) => taxonomy.indexOf(`name: '${name}'`));
  assert.equal(positions.every((value) => value >= 0), true);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);

  assert.match(
    taxonomy,
    /\['EMBER', 'SPARK', 'GLOW', 'BEACON', 'STAR', 'NOVA'\]/u
  );
  assert.match(taxonomy, /function workRankName/u);
});

test('canonical title catalog contains 100 reader and 40 author titles', () => {
  const readerIds = taxonomy.match(/^    'reader_[^']+':/gmu) ?? [];
  const authorIds = taxonomy.match(/^    'author_[^']+':/gmu) ?? [];
  assert.equal(readerIds.length, 100);
  assert.equal(authorIds.length, 40);
  assert.match(taxonomy, /'reader_master_scout': 'ARCHELIGHT'/u);
  assert.match(
    taxonomy,
    /'author_discovered_plus2_005': 'CONSTELLATION MAKER'/u
  );
  assert.match(taxonomy, /'limited_beta_participant': 'DAWNBOUND'/u);
});

test('SCOUT RECORD uses 称号 terminology and canonical taxonomy', () => {
  assert.match(scout, /称号コレクション/u);
  assert.match(scout, /獲得称号/u);
  assert.match(scout, /装備称号にする/u);
  assert.match(scout, /novelight-scout-taxonomy\.js/u);
  assert.ok(
    scout.indexOf('novelight-scout-taxonomy.js') <
      scout.indexOf('novelight-scout-record.js')
  );
  assert.match(scoutJs, /taxonomy\?\.titleName/u);
  assert.match(scoutJs, /SCOUT RANK —/u);
  assert.match(scoutJs, /装備称号を外す/u);
  assert.match(scoutJs, /workRankDisplay/u);

  for (const stale of [
    'Badge Collection',
    '獲得Badge',
    '公開Badge',
    '正式Rank名・エンブレム素材は後から差し替え可能'
  ]) {
    assert.equal(scout.includes(stale), false, `stale SCOUT copy: ${stale}`);
  }
});

test('public profile exposes one equipped title with official Scout Rank naming', () => {
  assert.match(author, /novelight-scout-taxonomy\.js/u);
  assert.ok(
    author.indexOf('novelight-scout-taxonomy.js') <
      author.indexOf('novelight-public-scout.js')
  );
  assert.match(publicScout, /装備称号/u);
  assert.match(publicScout, /SCOUT RANK —/u);
  assert.doesNotMatch(publicScout, /公開Badge/u);
});

test('site-wide renamed surfaces follow MASTER user-facing terminology', () => {
  assert.match(mypage, /Scout Rank・Level・称号・Scout Point/u);
  assert.doesNotMatch(mypage, /Scout Rank・Level・Badge・Scout Point/u);

  assert.match(episodePost, />公開チェック</u);
  assert.doesNotMatch(episodePost, /LIGHT READY｜公開前チェック/u);

  assert.match(adminScout, /称号獲得数/u);
  assert.match(adminScout, /称号別獲得率/u);
  assert.match(adminScout, /Scout XP分布/u);
  assert.doesNotMatch(adminScout, /Badge獲得数|Badge別獲得率|SCOUT EXP/u);

  assert.doesNotMatch(betaAuthors, /限定バッジ|永久限定バッジ|記念バッジ/u);
  assert.match(betaAuthors, /限定称号/u);
});
