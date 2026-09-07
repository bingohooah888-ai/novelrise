import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const assets = [
  'assets/author-room/author-room-hero-background.webp',
  'assets/author-room/author-room-sidebar-background.webp',
  'assets/author-room/author-room-activity-background.webp',
  'assets/author-room/author-room-profile-background.webp'
];

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
