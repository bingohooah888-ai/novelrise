import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const zoomSource = await readFile(
  new URL('../novelight-scout-badge-zoom.js', import.meta.url),
  'utf8'
);
const recordSource = await readFile(
  new URL('../scout-record.html', import.meta.url),
  'utf8'
);

test('SCOUT artwork keeps official logical source paths while normal display uses derivatives', () => {
  assert.match(zoomSource, /assets\\\/scout-badges\\\//);
  assert.match(zoomSource, /assets\\\/scout-record\\\/ranks\\\//);
  assert.match(zoomSource, /OPTIMIZER_PREFIX\s*=\s*'\/_vercel\/image\?'/);
  assert.match(zoomSource, /CARD_WIDTH\s*=\s*256/);
  assert.match(
    zoomSource,
    /optimizedScoutArtworkSource\(\s*source,\s*CARD_WIDTH,\s*CARD_QUALITY/
  );
});

test('SCOUT detail and zoom use display-appropriate optimized resolutions', () => {
  assert.match(zoomSource, /DETAIL_WIDTH\s*=\s*1080/);
  assert.match(zoomSource, /ZOOM_WIDTH\s*=\s*1600/);
  assert.match(zoomSource, /ZOOM_QUALITY\s*=\s*90/);
  assert.match(zoomSource, /data-novelight-original-src/);
  assert.match(
    zoomSource,
    /optimizedScoutArtworkSource\(originalSource, ZOOM_WIDTH, ZOOM_QUALITY\)/
  );
  assert.doesNotMatch(
    zoomSource,
    /this\.id === 'badgeArtworkZoomImage'[\s\S]{0,120}nativeSetSrc\.call\(this, source\)/
  );
});

test('SCOUT card artwork remains progressively loaded', () => {
  assert.match(zoomSource, /CARD_IMMEDIATE_COUNT\s*=\s*8/);
  assert.match(zoomSource, /IntersectionObserver/);
  assert.match(zoomSource, /this\.loading = 'lazy'/);
  assert.match(zoomSource, /fetchPriority.*'low'/);
});

test('official LIGHT SEED originals remain referenced and are not rewritten', () => {
  assert.match(
    recordSource,
    /assets\/scout-record\/light-seed\/light_seed_gold\.png/
  );
  assert.match(
    recordSource,
    /assets\/scout-record\/light-seed\/light_seed_silver\.png/
  );
  assert.match(
    recordSource,
    /assets\/scout-record\/light-seed\/light_seed_bronze\.png/
  );
});
