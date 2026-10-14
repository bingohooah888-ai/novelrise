import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('novelight-scout-record.js', 'utf8');
const after = source.split('function renderActivity(rows) {')[1];
assert.ok(after, 'SCOUT recent activity renderer exists');
const body = after.split('function renderSeedHistory(')[0];

test('recent activity appends records and preserves display boundaries', () => {
  assert.match(body, /host\.appendChild\(item\)/u);
  assert.match(body, /rows\.slice\(0, 12\)/u);
  assert.match(body, /まだ表示できるSCOUT活動はありません/u);
});
