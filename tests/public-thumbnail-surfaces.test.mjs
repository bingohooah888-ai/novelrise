import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [home, search, ranking, stagingSmoke] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../search.html', import.meta.url), 'utf8'),
  readFile(new URL('../ranking.html', import.meta.url), 'utf8'),
  readFile(new URL('./e2e/staging/thumbnail-flow.spec.js', import.meta.url), 'utf8')
]);

test('Home new arrivals hydrates and renders official thumbnails', () => {
  assert.match(home, /select\('id,thumbnail_url'\)/u);
  assert.match(home, /loadNewArrivals\(\)/u);
  assert.match(home, /class=\\?"novel-cover-image\\?"/u);
});

test('Search hydrates and renders official thumbnails', () => {
  assert.match(search, /select\('id,ai_usage,content_rating,thumbnail_url'\)/u);
  assert.match(search, /function coverMarkup\(n\)/u);
  assert.match(search, /class=\\?"novel-cover-image\\?"/u);
});

test('Ranking hydrates and renders official thumbnails', () => {
  assert.match(ranking, /function withOfficialThumbnails\(rows\)/u);
  assert.match(ranking, /select\('id,thumbnail_url'\)/u);
  assert.match(ranking, /class=\\?"novel-cover-image\\?"/u);
});

test('Staging thumbnail smoke asserts the shared public cover contract', () => {
  assert.match(stagingSmoke, /locator\('img\.novel-cover-image'\)/u);
  assert.doesNotMatch(stagingSmoke, /novelight-official-thumbnail/u);
});
