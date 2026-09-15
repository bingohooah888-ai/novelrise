import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const updates = await readFile('novelight-favorite-updates.js', 'utf8');
const updatesPage = await readFile('updates.html', 'utf8');
const authContext = await readFile('auth-reader-context.js', 'utf8');

test('favorite updates use existing favorite and published episode reads only', () => {
  assert.match(updates, /from\('favorites'\)/u);
  assert.match(updates, /from\('episodes'\)/u);
  assert.match(updates, /\.eq\('status', 'published'\)/u);
  assert.doesNotMatch(updates, /\.rpc\(/u);
});

test('first observation establishes a baseline instead of treating the backlog as new', () => {
  assert.match(updates, /if \(!seen && initialize\)/u);
  assert.match(updates, /writeSeen\(novelId, latestEpisodeNumber\(sorted\)\)/u);
  assert.match(updates, /return \[\];/u);
});

test('reading progress and acknowledged cursor both suppress already handled episodes', () => {
  assert.match(updates, /Number\(progress\?\.episodeNumber\) \|\| 0/u);
  assert.match(updates, /Number\(seen\?\.episodeNumber\) \|\| 0/u);
  assert.match(updates, /episodeNumber\(row\) > baseline/u);
});

test('updates page requires auth and supports per-work acknowledgement', () => {
  assert.match(updatesPage, /id="updatesList"/u);
  assert.match(updates, /login\.html\?redirect=updates\.html/u);
  assert.match(updates, /確認済みにする/u);
  assert.match(updates, /writeSeen\(item\.novelId, latestEpisodeNumber\(item\.allEpisodes\)\)/u);
});

test('home can load the update badge and auth return accepts the updates page', () => {
  assert.match(authContext, /\/updates\.html/u);
  assert.match(authContext, /novelight-favorite-updates\.js/u);
  assert.match(updates, /id = 'nlFavoriteUpdatesLink'/u);
  assert.match(updates, /お気に入り作品の更新/u);
});
