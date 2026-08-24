import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const home = await readFile('index.html', 'utf8');
const search = await readFile('search.html', 'utf8');
const analytics = await readFile('analytics.html', 'utf8');
const episode = await readFile('episode.html', 'utf8');
const mypage = await readFile('mypage.html', 'utf8');

test('home discovery is independent of attribution and impression telemetry', () => {
  assert.match(home, /void NovelightClient\.claimAcquisition\(client\)/);
  assert.match(home, /void record\('home_discovery'/);
  assert.match(home, /作品を読み込めませんでした。時間をおいて再度お試しください。/);
  assert.match(home, /catch\(e\)\{console\.error\('impression record failed'/);
});

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
