import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ARTWORK = [
  'assets/author-room/author-room-sidebar-background.webp',
  'assets/author-room/author-room-hero-background.webp',
  'assets/author-room/author-room-activity-background.webp',
  'assets/author-room/author-room-profile-background.webp'
];

function assertWebp(buffer, path) {
  assert.ok(buffer.length > 12, `${path} must not be empty`);
  assert.equal(buffer.subarray(0, 4).toString('ascii'), 'RIFF', `${path} must start with RIFF`);
  assert.equal(buffer.subarray(8, 12).toString('ascii'), 'WEBP', `${path} must contain a WEBP signature`);
}

test('author room background artwork files contain valid WebP container signatures', async () => {
  const files = await Promise.all(ARTWORK.map((path) => readFile(path)));
  for (let index = 0; index < files.length; index += 1) {
    assertWebp(files[index], ARTWORK[index]);
  }
});
