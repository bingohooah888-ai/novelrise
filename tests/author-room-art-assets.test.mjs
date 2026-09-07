import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const HERO_ASSET = 'assets/author-room/author-room-hero-background.webp';
const assets = [
  HERO_ASSET,
  'assets/author-room/author-room-sidebar-background.webp',
  'assets/author-room/author-room-activity-background.webp',
  'assets/author-room/author-room-profile-background.webp'
];

function readUint24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function getWebPDimensions(bytes) {
  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const type = bytes.subarray(offset, offset + 4).toString('ascii');
    const size = bytes.readUInt32LE(offset + 4);
    const payload = offset + 8;

    if (type === 'VP8X') {
      return {
        width: readUint24LE(bytes, payload + 4) + 1,
        height: readUint24LE(bytes, payload + 7) + 1
      };
    }

    if (type === 'VP8 ') {
      assert.deepEqual([...bytes.subarray(payload + 3, payload + 6)], [
        0x9d,
        0x01,
        0x2a
      ]);
      return {
        width: bytes.readUInt16LE(payload + 6) & 0x3fff,
        height: bytes.readUInt16LE(payload + 8) & 0x3fff
      };
    }

    offset = payload + size + (size & 1);
  }

  throw new Error('WebP dimension chunk not found');
}

test('author room background assets are valid WebP containers', async () => {
  for (const asset of assets) {
    const bytes = await readFile(asset);
    assert.ok(bytes.length > 1024, `${asset} should contain real artwork`);
    assert.equal(
      bytes.subarray(0, 4).toString('ascii'),
      'RIFF',
      `${asset} must start with RIFF`
    );
    assert.equal(
      bytes.subarray(8, 12).toString('ascii'),
      'WEBP',
      `${asset} must contain WEBP magic`
    );
  }
});

test('author room hero keeps a real landscape source instead of a stretched image fragment', async () => {
  const bytes = await readFile(HERO_ASSET);
  const { width, height } = getWebPDimensions(bytes);

  assert.ok(bytes.length >= 8000, 'hero artwork should contain enough image data');
  assert.ok(width >= 600, 'hero artwork should stay at least 600px wide');
  assert.ok(height >= 200, 'hero artwork should stay at least 200px tall');
  assert.ok(
    width / height >= 2.8,
    'hero artwork should keep the supplied landscape aspect ratio'
  );
});
