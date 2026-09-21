import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const author = await readFile('author.html', 'utf8');
const js = await readFile('novelight-public-scout.js', 'utf8');
const css = await readFile('novelight-public-scout.css', 'utf8');

test('author profile has a public SCOUT RECORD surface', () => {
  assert.match(author, /id="publicScoutRecord"/u);
  assert.match(author, /novelight-public-scout\.css/u);
  assert.match(author, /novelight-public-scout\.js/u);
});

test('public SCOUT RECORD loads only the public-safe RPC', () => {
  assert.match(js, /novelight_public_scout_record/u);
  assert.match(js, /Scout Level/u);
  assert.match(js, /発掘成功/u);
  assert.match(js, /公開Badge/u);
  assert.match(js, /代表的な発掘実績/u);
  assert.doesNotMatch(js, /scout_point_ledger|point_balance|pending_points|total_xp|next_level_xp/iu);
});

test('public SCOUT surface remains mobile responsive', () => {
  assert.match(css, /@media\(max-width:640px\)/u);
  assert.match(css, /\.public-scout-summary\{grid-template-columns:1fr 1fr\}/u);
});
