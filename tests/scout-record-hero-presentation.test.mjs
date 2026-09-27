import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const html = fs.readFileSync(
  new URL('../scout-record.html', import.meta.url),
  'utf8'
);

test('SCOUT RECORD hero uses the simplified rank and point presentation', () => {
  assert.match(
    html,
    /class="scout-kicker scout-rank-title">SCOUT RANK<\/div>/
  );
  assert.match(html, /<strong id="rankName">—<\/strong>/);
  assert.doesNotMatch(html, /id="rankLevel"/);
  assert.doesNotMatch(html, /DISCOVERY COMPASS/);
  assert.doesNotMatch(html, /scout-point-month/);
  assert.doesNotMatch(html, /id="monthPoint"/);
  assert.doesNotMatch(html, /id="pendingPoint"/);
  assert.match(html, /replace\(\/\^SCOUT RANK\\s\*—\\s\*\/u, ''\)/);
});
