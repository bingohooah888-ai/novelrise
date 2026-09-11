import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import {
  generateCoverMaskPng,
  normalizeCoverQuad
} from '../api/_lib/cover-mask-png.js';

const migration = await readFile(
  'supabase/migrations/20260911003000_chapter39_cover_quad_source.sql',
  'utf8'
);
const rollback = await readFile(
  'supabase/rollback/20260911003000_chapter39_cover_quad_source_rollback.sql',
  'utf8'
);
const admin = await readFile('admin-thumbnails.html', 'utf8');
const adminApi = await readFile('api/_lib/admin-thumbnails.js', 'utf8');
const composer = await readFile('novelight-thumbnail-composer.js', 'utf8');

function decodeRgbaPng(buffer) {
  assert.deepEqual(
    Array.from(buffer.subarray(0, 8)),
    [137, 80, 78, 71, 13, 10, 26, 10]
  );
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8);
      assert.equal(data[9], 6);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  return { width, height, raw, stride: width * 4 + 1 };
}

function pixel(decoded, x, y) {
  const rowOffset = y * decoded.stride;
  assert.equal(decoded.raw[rowOffset], 0, 'PNG row must use filter 0');
  const offset = rowOffset + 1 + x * 4;
  return Array.from(decoded.raw.subarray(offset, offset + 4));
}

test('cover quad validation keeps integer convex geometry inside 1086x1448', () => {
  const quad = normalizeCoverQuad({
    top_left: { x: 120, y: 160 },
    top_right: { x: 930, y: 250 },
    bottom_right: { x: 850, y: 1120 },
    bottom_left: { x: 180, y: 1030 }
  });
  assert.equal(quad.top_left.x, 120);
  assert.throws(
    () =>
      normalizeCoverQuad({
        top_left: { x: 120.5, y: 160 },
        top_right: { x: 930, y: 250 },
        bottom_right: { x: 850, y: 1120 },
        bottom_left: { x: 180, y: 1030 }
      }),
    /integer coordinates/
  );
});

test('generated debug mask PNG is 1086x1448 and contains only binary alpha', () => {
  const png = generateCoverMaskPng({
    top_left: { x: 100, y: 200 },
    top_right: { x: 900, y: 200 },
    bottom_right: { x: 900, y: 1000 },
    bottom_left: { x: 100, y: 1000 }
  });
  const decoded = decodeRgbaPng(png);
  assert.equal(decoded.width, 1086);
  assert.equal(decoded.height, 1448);
  assert.deepEqual(pixel(decoded, 500, 500), [255, 255, 255, 255]);
  assert.deepEqual(pixel(decoded, 20, 20), [0, 0, 0, 0]);
  const alphaValues = new Set();
  for (let y = 0; y < decoded.height; y += 1) {
    for (let x = 0; x < decoded.width; x += 1) {
      alphaValues.add(decoded.raw[y * decoded.stride + 1 + x * 4 + 3]);
    }
  }
  assert.deepEqual(
    [...alphaValues].sort((a, b) => a - b),
    [0, 255]
  );
});

test('Chapter 39 migration stores the four vertices as canonical template data', () => {
  for (const column of [
    'cover_top_left_x',
    'cover_top_left_y',
    'cover_top_right_x',
    'cover_top_right_y',
    'cover_bottom_right_x',
    'cover_bottom_right_y',
    'cover_bottom_left_x',
    'cover_bottom_left_y'
  ])
    assert.ok(migration.includes(column), `missing ${column}`);
  assert.match(
    migration,
    /cover_mask_source text not null default 'legacy_asset'/i
  );
  assert.match(migration, /cover_mask_source = 'cover_quad'/i);
  assert.ok(migration.includes("'generated-masks/'"));
  assert.ok(migration.includes("'-cover-mask.png'"));
  assert.match(
    migration,
    /template_key <> 'book-v1'\s+or cover_mask_source = 'cover_quad'/i
  );
  assert.match(migration, /render_storage_path = null/i);
  assert.match(migration, /render_url = null/i);
});

test('ADMIN keeps derived PNG generation but does not accept manual mask uploads', () => {
  assert.ok(adminApi.includes('generateCoverMaskPng'));
  assert.ok(adminApi.includes("action === 'set-cover-quad'"));
  assert.ok(adminApi.includes("contentType: 'image/png'"));
  assert.ok(
    adminApi.includes('novelight_admin_set_thumbnail_template_cover_quad')
  );
  assert.ok(admin.includes('4頂点を保存してdebug mask生成'));
  assert.ok(admin.includes("quadCanvas.addEventListener('pointermove'"));
  assert.ok(admin.includes('debug mask PNGは描画には使用しません'));
  assert.doesNotMatch(
    admin,
    /<option value="cover_mask">内部表紙マスク<\/option>/
  );
});

test('Chapter 40 supersedes Chapter 39 mask rendering while preserving quad-derived debug masks', () => {
  assert.ok(
    composer.includes(
      "const SURFACE_TYPES = ['cover', 'pattern', 'symbol', 'frame']"
    )
  );
  assert.ok(
    composer.includes(
      'await drawPerspectiveAsset(context, selected[type], quad)'
    )
  );
  assert.doesNotMatch(
    composer,
    /globalCompositeOperation\s*=\s*['"]destination-in['"]/
  );
  assert.ok(composer.includes("template.cover_mask_source !== 'cover_quad'"));
  assert.ok(admin.includes('debug mask'));
});

test('rollback refuses to discard canonical quad geometry after adoption', () => {
  assert.match(
    rollback,
    /rollback refused: quad-backed thumbnail templates exist/i
  );
  assert.match(rollback, /drop column if exists cover_top_left_x/i);
});
