import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile('novelight-scout-record.js', 'utf8');
const styles = await readFile('novelight-scout-record.css', 'utf8');

const easyReaderBadgeIds = [
  'reader_read_001',
  'reader_read_005',
  'reader_read_010',
  'reader_read_025',
  'reader_rating_001',
  'reader_rating_005',
  'reader_rating_010',
  'reader_comment_001',
  'reader_comment_005',
  'reader_comment_010',
  'reader_seed_001',
  'reader_seed_003',
  'reader_seed_005',
  'reader_seed_010',
  'reader_bronze_seed_001',
  'reader_silver_seed_001',
  'reader_gold_seed_001',
  'reader_discovery_plus2_001',
  'reader_discovery_plus2_002',
  'reader_discovery_plus2_003',
  'reader_new_author_005',
  'reader_new_author_010',
  'reader_genre_003',
  'reader_genre_005',
  'reader_new_work_005',
  'reader_low_rank_005',
  'reader_level_005',
  'reader_level_010',
  'reader_level_020',
  'reader_active_days_007'
];

test('Reader Easy artwork uses individual lossless PNG assets', async () => {
  for (const badgeId of easyReaderBadgeIds) {
    const assetPath = `assets/scout-reader-easy/${badgeId}.png`;
    assert.ok(script.includes(assetPath), `missing artwork path: ${assetPath}`);

    const png = await readFile(assetPath);
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
    assert.equal(png.readUInt32BE(16), 512);
    assert.equal(png.readUInt32BE(20), 512);
  }
});

test('Reader Easy artwork no longer depends on the low-resolution sprite', () => {
  assert.equal(script.includes('easyReaderBadgeSpriteIndexes'), false);
  assert.equal(script.includes('badgeSpritePosition'), false);
  assert.equal(script.includes('applyBadgeSprite'), false);
  assert.equal(styles.includes('scout-reader-easy-badges.webp'), false);
  assert.equal(styles.includes('.badge-icon-sprite'), false);
  assert.equal(styles.includes('.badge-dialog-artwork.badge-dialog-sprite'), false);
});

test('SCOUT RECORD renders title artwork through image elements', () => {
  assert.ok(script.includes('image.src = artworkPath'));
  assert.ok(script.includes("icon.classList.add('badge-icon-artwork')"));
  assert.ok(styles.includes('.badge-icon-artwork img'));
  assert.ok(styles.includes('object-fit:contain!important'));
});
