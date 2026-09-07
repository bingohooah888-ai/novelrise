import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const assets = [
  'assets/author-room/author-room-hero-background.webp',
  'assets/author-room/author-room-sidebar-background.webp',
  'assets/author-room/author-room-activity-background.webp',
  'assets/author-room/author-room-profile-background.webp'
];

function webpDimensions(bytes) {
  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const chunkType = bytes.subarray(offset, offset + 4).toString('ascii');
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;

    if (chunkType === 'VP8X') {
      return {
        width: bytes.readUIntLE(dataOffset + 4, 3) + 1,
        height: bytes.readUIntLE(dataOffset + 7, 3) + 1
      };
    }

    if (chunkType === 'VP8 ') {
      assert.equal(
        bytes.subarray(dataOffset + 3, dataOffset + 6).toString('hex'),
        '9d012a',
        'VP8 frame header must contain the expected start code'
      );
      return {
        width: bytes.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: bytes.readUInt16LE(dataOffset + 8) & 0x3fff
      };
    }

    if (chunkType === 'VP8L') {
      assert.equal(bytes[dataOffset], 0x2f, 'VP8L signature must be 0x2f');
      const dimensions = bytes.readUInt32LE(dataOffset + 1);
      return {
        width: (dimensions & 0x3fff) + 1,
        height: ((dimensions >>> 14) & 0x3fff) + 1
      };
    }

    offset = dataOffset + chunkSize + (chunkSize % 2);
  }

  throw new Error('WebP image dimensions could not be determined');
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

test('author room hero stays 1200x400', async () => {
  const bytes = await readFile(assets[0]);
  assert.deepEqual(webpDimensions(bytes), { width: 1200, height: 400 });
});
