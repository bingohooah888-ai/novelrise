import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { episodeIllustrationInternals } from '../api/_lib/episode-illustrations.js';

const browser = await readFile('novelight-episode-illustrations.js', 'utf8');
const {
  PATH_PATTERN,
  deliveryMimeFromExtension,
  deliveryMimeType,
  pngDimensions
} = episodeIllustrationInternals;

const ownerId = '11111111-1111-4111-8111-111111111111';
const assetId = '22222222-2222-4222-8222-222222222222';

test('episode illustration delivery contract accepts only WebP and PNG', () => {
  assert.equal(deliveryMimeType('image/webp'), 'image/webp');
  assert.equal(deliveryMimeType('image/png'), 'image/png');
  assert.equal(deliveryMimeType('image/jpeg'), null);
  assert.equal(deliveryMimeFromExtension('webp'), 'image/webp');
  assert.equal(deliveryMimeFromExtension('png'), 'image/png');
  assert.match(`${ownerId}/123/${assetId}.webp`, PATH_PATTERN);
  assert.match(`${ownerId}/123/${assetId}.png`, PATH_PATTERN);
  assert.doesNotMatch(`${ownerId}/123/${assetId}.jpg`, PATH_PATTERN);
});

test('PNG signature and IHDR dimensions are validated', () => {
  const png = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(1200, 16);
  png.writeUInt32BE(800, 20);
  assert.deepEqual(pngDimensions(png), { width: 1200, height: 800 });

  const invalid = Buffer.from(png);
  invalid[0] = 0;
  assert.throws(() => pngDimensions(invalid), /INVALID_PNG/u);
});

test('browser propagates the actual canvas Blob MIME through upload', () => {
  assert.match(browser, /const mimeType = String\(blob\.type \|\| ''\)\.toLowerCase\(\)/u);
  assert.match(browser, /DELIVERY_TYPES\.has\(mimeType\)/u);
  assert.match(browser, /mimeType: optimized\.mimeType/u);
  assert.match(browser, /contentType: optimized\.mimeType/u);
});
