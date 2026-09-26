import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const badgeIds = [
  'reader_read_050',
  'reader_read_100',
  'reader_read_250',
  'reader_read_500',
  'reader_rating_025',
  'reader_rating_050',
  'reader_rating_100',
  'reader_comment_025',
  'reader_comment_050',
  'reader_comment_100',
  'reader_seed_025',
  'reader_seed_050',
  'reader_seed_100',
  'reader_seed_250',
  'reader_seed_500',
  'reader_seed_1000',
  'reader_bronze_seed_003',
  'reader_bronze_seed_005',
  'reader_bronze_seed_010',
  'reader_silver_seed_003',
  'reader_silver_seed_005',
  'reader_silver_seed_010',
  'reader_gold_seed_003',
  'reader_gold_seed_005',
  'reader_gold_seed_010',
  'reader_discovery_plus2_005',
  'reader_discovery_plus2_010',
  'reader_discovery_plus2_025',
  'reader_discovery_plus2_050',
  'reader_discovery_plus2_100',
  'reader_new_author_025',
  'reader_new_author_050',
  'reader_new_author_100',
  'reader_genre_010',
  'reader_genre_020',
  'reader_genre_030',
  'reader_new_work_010',
  'reader_new_work_025',
  'reader_low_rank_010',
  'reader_low_rank_025',
  'reader_series_complete_001',
  'reader_series_complete_003',
  'reader_series_complete_005',
  'reader_completed_read_005',
  'reader_completed_read_010',
  'reader_active_days_030',
  'reader_active_days_090',
  'reader_level_030',
  'reader_point_100',
  'reader_point_500'
];

const scoutJs = await readFile(
  new URL('../novelight-scout-record.js', import.meta.url),
  'utf8'
);
const manifestText = await readFile(
  new URL(
    '../docs/SCOUT-BADGE-READER-NORMAL-31-80-MANIFEST.csv',
    import.meta.url
  ),
  'utf8'
);

const [headerLine, ...dataLines] = manifestText.trim().split(/\r?\n/u);
const headers = headerLine.split(',');
const rows = dataLines.map((line) => {
  const values = line.split(',');
  return Object.fromEntries(
    headers.map((header, index) => [header, values[index] ?? ''])
  );
});

test('Reader Normal #31-#80 preserve approved provenance and canonical PNG bytes', async () => {
  assert.equal(badgeIds.length, 50);
  assert.equal(rows.length, 50);

  for (let index = 0; index < 50; index += 1) {
    const badgeNo = index + 31;
    const badgeId = badgeIds[index];
    const row = rows[index];
    const serial = String(badgeNo).padStart(3, '0');

    assert.equal(Number(row.badge_no), badgeNo, `manifest order for #${serial}`);
    assert.equal(row.packaged_filename, `Reader_Normal_${serial}.png`);
    assert.equal(Number(row.width), 1254, `${badgeId} manifest width`);
    assert.equal(Number(row.height), 1254, `${badgeId} manifest height`);
    assert.equal(row.mode, 'RGBA', `${badgeId} manifest mode`);
    assert.equal(row.alpha_min, '0', `${badgeId} alpha_min`);
    assert.equal(row.alpha_max, '255', `${badgeId} alpha_max`);
    assert.equal(row.corner_alpha, '0/0/0/0', `${badgeId} transparent corners`);
    assert.match(row.source_sha256, /^[0-9a-f]{64}$/u);
    assert.match(row.packaged_sha256, /^[0-9a-f]{64}$/u);

    if (badgeNo === 45) {
      assert.notEqual(row.source_sha256, row.packaged_sha256);
      assert.match(
        row.note,
        /approved design; exterior black canvas mechanically converted to alpha transparency/u
      );
    } else {
      assert.equal(
        row.source_sha256,
        row.packaged_sha256,
        `${badgeId} must remain a byte-for-byte copy of its approved source`
      );
      assert.equal(row.note, 'byte-for-byte copy of approved source');
    }

    assert.match(
      scoutJs,
      new RegExp(`${badgeId}: 'assets/scout-badges/${badgeId}\\.png'`, 'u')
    );

    const bytes = await readFile(
      new URL(`../assets/scout-badges/${badgeId}.png`, import.meta.url)
    );
    assert.deepEqual(
      [...bytes.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
      `${badgeId} must be a PNG`
    );
    assert.equal(bytes.readUInt32BE(16), 1254, `${badgeId} canonical width`);
    assert.equal(bytes.readUInt32BE(20), 1254, `${badgeId} canonical height`);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      row.packaged_sha256,
      `${badgeId} canonical bytes must match the approved transfer manifest`
    );
  }
});
