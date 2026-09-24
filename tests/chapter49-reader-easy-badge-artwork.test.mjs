import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile('novelight-scout-record.js', 'utf8');
const styles = await readFile('novelight-scout-record.css', 'utf8');
const sprite = await readFile('assets/scout-reader-easy-badges.webp');

const expectedEasyIds = [
  "reader_read_001",
  "reader_read_005",
  "reader_read_010",
  "reader_read_025",
  "reader_rating_001",
  "reader_rating_005",
  "reader_rating_010",
  "reader_comment_001",
  "reader_comment_005",
  "reader_comment_010",
  "reader_seed_001",
  "reader_seed_003",
  "reader_seed_005",
  "reader_seed_010",
  "reader_bronze_seed_001",
  "reader_silver_seed_001",
  "reader_gold_seed_001",
  "reader_discovery_plus2_001",
  "reader_discovery_plus2_002",
  "reader_discovery_plus2_003",
  "reader_new_author_005",
  "reader_new_author_010",
  "reader_genre_003",
  "reader_genre_005",
  "reader_new_work_005",
  "reader_low_rank_005",
  "reader_level_005",
  "reader_level_010",
  "reader_level_020",
  "reader_active_days_007"
];

function readUint24Le(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

test('Reader Easy Badge artwork maps all 30 canonical ids in order', () => {
  const match = script.match(
    /const easyReaderBadgeArtworkIds = \[([\s\S]*?)\n  \];/u
  );
  assert.ok(match, 'Easy Reader Badge artwork id list is missing');
  const actualIds = [...match[1].matchAll(/'([^']+)'/gu)].map((entry) => entry[1]);
  assert.deepEqual(actualIds, expectedEasyIds);
  assert.equal(new Set(actualIds).size, 30);
});

test('Reader Easy Badge sprite is a 6 by 5 WebP grid', () => {
  assert.equal(sprite.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(sprite.subarray(8, 12).toString('ascii'), 'WEBP');
  assert.equal(sprite.subarray(12, 16).toString('ascii'), 'VP8X');
  assert.equal(readUint24Le(sprite, 24) + 1, 384);
  assert.equal(readUint24Le(sprite, 27) + 1, 320);
  assert.ok(sprite.length > 50000);
});

test('SCOUT RECORD renders Easy artwork in cards and badge dialog', () => {
  assert.match(script, /easyReaderBadgeSpriteIndexes/u);
  assert.match(script, /applyBadgeSprite\(icon, row\)/u);
  assert.match(script, /applyBadgeSprite\(host, row\)/u);
  assert.match(styles, /assets\/scout-reader-easy-badges\.webp/u);
  assert.match(styles, /background-size:600% 500%/u);
  assert.match(styles, /\.badge-icon-sprite/u);
  assert.match(styles, /\.badge-dialog-artwork\.badge-dialog-sprite/u);
});
