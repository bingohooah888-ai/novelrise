import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const source = await readFile(
  new URL('../novelight-public-scout.js', import.meta.url),
  'utf8'
);

test('equipped SCOUT artwork uses a small optimized derivative', () => {
  assert.match(source, /EQUIPPED_BADGE_WIDTH\s*=\s*96/);
  assert.match(source, /EQUIPPED_BADGE_QUALITY\s*=\s*80/);
  assert.match(source, /\/_vercel\/image\?url=/);
  assert.match(source, /image\.src\s*=\s*optimizedArtworkPath\(artworkPath\)/);
  assert.doesNotMatch(source, /image\.src\s*=\s*artworkPath\s*;/);
});

test('equipped SCOUT artwork preserves provenance and avoids eager original loading', () => {
  assert.match(
    source,
    /image\.dataset\.novelightOriginalSrc\s*=\s*artworkPath/
  );
  assert.match(source, /image\.loading\s*=\s*'lazy'/);
  assert.match(source, /image\.decoding\s*=\s*'async'/);
  assert.match(source, /image\.fetchPriority\s*=\s*'low'/);
  assert.match(source, /image\.width\s*=\s*46/);
  assert.match(source, /image\.height\s*=\s*46/);
});