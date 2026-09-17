import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { inspectPng, parseZip } from '../novelight-thumbnail-batch-import.js';

const manifest = JSON.parse(
  await readFile(
    new URL('../novelight-thumbnail-assets-v1.json', import.meta.url),
    'utf8'
  )
);

const correctedPatternHashes = new Map([
  [
    'pattern_magiccircle_01',
    '3ff24a00380f0c74687ddd6a45dbddf65b03c092da2c3499ff2941f73b19cb20'
  ],
  [
    'pattern_botanical_01',
    'c67e3d49ea95a3dc2cccd03484b85869f465f2042aeca6775c6c3e51c2174018'
  ],
  [
    'pattern_gear_01',
    '94831cef399618e8861c6fc4009774d8d744fc90f27e09faa1b34f4e4e707da1'
  ],
  [
    'pattern_ruins_01',
    'a2b26fc7353c6d838220cd42c5249886ec4171a4df4203fbcae33cddbe7eb141'
  ],
  [
    'pattern_constellation_01',
    'fda704fb0f0ac9f5df9a5da19ada03ae9447f140caf3eb68f6bc1d9b77542d1c'
  ],
  [
    'pattern_ripplecrystal_01',
    '4cd76fbf0d19e674053be757990633f870a1c3a90e710bde72aeca7b6d427006'
  ],
  [
    'pattern_featherwind_01',
    '4055c9fccc04043a38223bd2d3f5d77ab6bbd9a62dd8db9555c4b77e80cedca2'
  ],
  [
    'pattern_flameflash_01',
    'c3436ce9997693b77bf71eaa751ce46a0aac8d0a02f242137cc7ad0d0bd9f1a6'
  ]
]);

test('official thumbnail v1 manifest locks exactly 30 corrected assets', () => {
  assert.equal(manifest.packKey, 'NOVELIGHT_thumbnail_assets_v1_30');
  assert.equal(manifest.templateKey, 'book-v1');
  assert.equal(manifest.items.length, 30);
  const counts = Object.fromEntries(
    ['texture', 'symbol', 'frame', 'pattern', 'effect'].map((category) => [
      category,
      manifest.items.filter((item) => item.sourceCategory === category).length
    ])
  );
  assert.deepEqual(counts, {
    texture: 6,
    symbol: 8,
    frame: 4,
    pattern: 8,
    effect: 4
  });
  for (const item of manifest.items) {
    assert.equal(item.width, 1024);
    assert.equal(item.height, 1536);
    assert.equal(item.bitDepth, 8);
    assert.equal(item.colorType, 6);
    assert.match(item.sha256, /^[0-9a-f]{64}$/);
    assert.equal(item.templateKey, 'book-v1');
    if (item.sourceCategory === 'texture') assert.equal(item.layerType, 'cover');
    else assert.equal(item.layerType, item.sourceCategory);
  }
  for (const [key, sha] of correctedPatternHashes) {
    assert.equal(
      manifest.items.find((item) => item.key === key)?.sha256,
      sha
    );
  }
});

test('batch import page uses only the existing official admin upload path', async () => {
  const html = await readFile(
    new URL('../admin-thumbnail-batch.html', import.meta.url),
    'utf8'
  );
  const module = await readFile(
    new URL('../novelight-thumbnail-batch-import.js', import.meta.url),
    'utf8'
  );
  assert.match(html, /admin-thumbnails/);
  assert.match(module, /action:\s*'prepare-upload'/);
  assert.match(module, /uploadToSignedUrl/);
  assert.match(module, /action:\s*'finalize-upload'/);
  assert.match(module, /templateKey:\s*item\.templateKey/);
  assert.doesNotMatch(module, /set-cover-quad/);
  assert.doesNotMatch(module, /generated-masks/);
});

test('PNG header inspection requires the fixed RGBA geometry asset contract', () => {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  new DataView(bytes.buffer).setUint32(8, 13, false);
  bytes.set([73, 72, 68, 82], 12);
  new DataView(bytes.buffer).setUint32(16, 1024, false);
  new DataView(bytes.buffer).setUint32(20, 1536, false);
  bytes[24] = 8;
  bytes[25] = 6;
  const png = inspectPng(bytes);
  assert.deepEqual(
    {
      width: png.width,
      height: png.height,
      bitDepth: png.bitDepth,
      colorType: png.colorType
    },
    { width: 1024, height: 1536, bitDepth: 8, colorType: 6 }
  );
});

test('ZIP parser fails closed on non-ZIP input', () => {
  assert.throws(() => parseZip(new Uint8Array(64).buffer), /ZIP/);
});
