import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const badgeIds = [
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

const script = await readFile('novelight-scout-record.js', 'utf8');
const styles = await readFile('novelight-scout-record.css', 'utf8');

test('Reader Easy artwork maps every canonical badge id to an individual PNG', async () => {
  const files = (await readdir('assets/scout-badges'))
    .filter((name) => name.endsWith('.png'))
    .sort();
  const expectedFiles = badgeIds.map((badgeId) => `${badgeId}.png`).sort();

  assert.deepEqual(files, expectedFiles);

  for (const badgeId of badgeIds) {
    const assetPath = `assets/scout-badges/${badgeId}.png`;
    assert.ok(script.includes(`${badgeId}: '${assetPath}'`), badgeId);

    const png = await readFile(assetPath);
    assert.deepEqual(
      [...png.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10]
    );
    assert.equal(png.readUInt32BE(16), 384, `${badgeId} width`);
    assert.equal(png.readUInt32BE(20), 384, `${badgeId} height`);
  }
});

test('Reader Easy artwork no longer depends on sprite positioning', () => {
  for (const legacy of [
    'scout-reader-easy-badges.webp',
    'easyReaderBadgeSpriteIndexes',
    'badgeSpritePosition',
    'applyBadgeSprite',
    'badge-icon-sprite',
    'badge-dialog-sprite',
    '--badge-sprite'
  ]) {
    assert.equal(
      script.includes(legacy) || styles.includes(legacy),
      false,
      legacy
    );
  }

  assert.ok(
    styles.includes('.badge-icon-artwork.badge-icon-reader-easy-artwork{')
  );
  assert.ok(
    styles.includes(
      '.badge-dialog-artwork.badge-dialog-reader-easy-artwork img{'
    )
  );
});

test('Founding Author artwork and glyph fallback remain intact', () => {
  assert.ok(
    script.includes(
      "limited_founding_author: 'assets/founding-authors-badge-2026.png'"
    )
  );
  assert.ok(script.includes('icon.textContent = badgeIcon(row);'));
  assert.ok(
    script.includes('const artworkPath = badgeArtworkPaths[row.badge_id];')
  );
  assert.ok(
    script.includes(
      "host.classList.remove('badge-dialog-reader-easy-artwork');"
    )
  );
});
