import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('novelight-scout-record.js', 'utf8');
const after = source.split('function renderActivity(rows, { append = false')[1];
assert.ok(after, 'SCOUT unified activity renderer exists');
const body = after.split('async function loadActivityPage(')[0];

test('unified timeline displays up to twenty items per page', () => {
  assert.match(body, /host\.appendChild\(item\)/u);
  assert.match(body, /host\.replaceChildren\(\)/u);
  assert.match(body, /hasMore/u);
  assert.match(body, /この条件の活動履歴はありません/u);
});

test('unified timeline includes an original work link', () => {
  assert.match(body, /row\.novel_title/u);
  assert.match(body, /novel\.html\?id=/u);
});
