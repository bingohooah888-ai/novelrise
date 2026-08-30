import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const search = await readFile('search.html', 'utf8');
const analytics = await readFile('analytics.html', 'utf8');
const episode = await readFile('episode.html', 'utf8');
const mypage = await readFile('mypage.html', 'utf8');
const novel = await readFile('novel.html', 'utf8');
const post = await readFile('post.html', 'utf8');
const novelEdit = await readFile('novel-edit.html', 'utf8');
const episodePost = await readFile('episode-post.html', 'utf8');
const episodeEdit = await readFile('episode-edit.html', 'utf8');
const scoutRecord = await readFile('scout-record.html', 'utf8');
const pricing = await readFile('pricing.html', 'utf8');
const myNovels = await readFile('my-novels.html', 'utf8');
const ranking = await readFile('ranking.html', 'utf8');
const author = await readFile('author.html', 'utf8');
const favorites = await readFile('favorites.html', 'utf8');

test('search drops stale async results', () => {
  assert.match(search, /rows=await enrich\(rows\)/);
  assert.match(search, /if\(current!==requestId\)return;render\(rows\)/);
  assert.match(search, /if\(r\.error\)throw r\.error/);
});

test('analytics drops stale period results', () => {
  assert.match(analytics, /funnelRequestId=0/);
  assert.match(analytics, /if\(current!==funnelRequestId\)return/);
  assert.match(analytics, /clearFunnel\('取得できませんでした'\)/);
  assert.match(analytics, /基本分析を読み込めませんでした/);
});

test('episode renders before optional PV telemetry', () => {
  assert.doesNotMatch(episode, /async function render\(\)/);
  assert.match(episode, /void updatePv\(\)/);
  assert.match(episode, /pv storage unavailable/);
  assert.match(episode, /送信中\.\.\./);
});

test('author home distinguishes loading and failure states', () => {
  assert.match(mypage, /function analyticsUnavailable\(\)/);
  assert.match(mypage, /void NovelightClient\.claimAcquisition\(client\)/);
  assert.match(mypage, /profileReady=false/);
  assert.match(mypage, /type="submit" disabled/);
  assert.match(mypage, /profileReady=true;save\.disabled=false/);
  assert.match(mypage, /if\(!profileReady\)/);
  assert.match(mypage, /finally\{b\.disabled=!profileReady\}/);
});

test('novel detail renders independently of optional async work', () => {
  assert.match(novel, /function renderNovel\(\)/);
  assert.match(novel, /void loadAuthorMeta\(\)/);
  assert.match(novel, /void loadEpisodes\(\)/);
  assert.match(novel, /void setupFavorite\(\)/);
  assert.match(novel, /void setupSeed\(\)/);
  assert.match(novel, /void recordOpen\(\)/);
  assert.match(novel, /エピソードも読み込めません/);
});

test('author forms recover from async failures and prevent duplicate submits', () => {
  for (const page of [post, novelEdit, episodePost, episodeEdit]) {
    assert.match(page, /busy=false/);
    assert.match(page, /if\([^)]*busy/);
    assert.match(page, /finally\{/);
  }
  assert.match(post, /void NovelightClient\.claimAcquisition\(client\)/);
  assert.match(novelEdit, /type="submit" disabled/);
  assert.match(episodePost, /client\.rpc\('novelight_publish_episode_atomic'/);
  assert.doesNotMatch(episodePost, /episodeSaved/);
  assert.doesNotMatch(episodePost, /client\.from\('episodes'\)\.insert/);
  assert.doesNotMatch(episodePost, /client\.from\('novels'\)\.update/);
  assert.match(episodeEdit, /type="submit" disabled/);
});

test('scout record separates metadata failures from unpublished works', () => {
  assert.match(scoutRecord, /metadataUnavailable=false/);
  assert.match(scoutRecord, /作品情報の取得エラー/);
  assert.match(scoutRecord, /void NovelightClient\.claimAcquisition\(client\)/);
});

test('billing prevents parallel checkout starts and recovers after failure', () => {
  assert.match(pricing, /busy=false/);
  assert.match(pricing, /if\(busy\)return/);
  assert.match(pricing, /function disablePaid\(v\)/);
  assert.match(pricing, /finally\{busy=false;disablePaid\(false\)\}/);
  assert.match(
    pricing,
    /void NovelightClient\.claimAcquisition\(analyticsClient\)/
  );
});

test('remaining list pages distinguish unavailable data from real empty states', () => {
  assert.match(myNovels, /favoriteCountsAvailable=true/);
  assert.match(myNovels, /favorite counts unavailable/);
  assert.match(myNovels, /rpc\('novelight_author_favorite_counts'/);
  assert.match(ranking, /ランキングを正しく計算できませんでした/);
  assert.match(ranking, /if\(r\.error\)throw r\.error/);
  assert.match(author, /公開作品を読み込めませんでした/);
  assert.match(author, /if\(n\.error\)/);
});

test('favorites leaves loading state on auth and data failures', () => {
  assert.match(favorites, /try\{const a=await client\.auth\.getSession\(\)/);
  assert.match(favorites, /if\(a\.error\)throw a\.error/);
  assert.match(favorites, /if\(r\.error\)throw r\.error/);
  assert.match(
    favorites,
    /catch\(error\)\{console\.error\('favorites load failed'/
  );
  assert.match(
    favorites,
    /お気に入り作品を表示できませんでした。通信状況を確認して、もう一度お試しください。/
  );
});
