import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const zoomSource = await readFile(
  new URL('../novelight-scout-badge-zoom.js', import.meta.url),
  'utf8'
);
const vercelConfig = JSON.parse(
  await readFile(new URL('../vercel.json', import.meta.url), 'utf8')
);

const csp =
  vercelConfig.headers?.[0]?.headers?.find(
    ({ key }) => String(key).toLowerCase() === 'content-security-policy'
  )?.value ?? '';
const imageDirective = csp.match(/(?:^|;\s*)img-src\s+([^;]+)/u)?.[1] ?? '';

test('SCOUT badge enhanced zoom uses a Production-CSP-compatible image source', () => {
  assert.match(imageDirective, /(?:^|\s)data:(?:\s|$)/u);

  assert.match(zoomSource, /canvas\.toDataURL\('image\/png'\)/u);
  assert.doesNotMatch(zoomSource, /URL\.createObjectURL/u);
  assert.doesNotMatch(zoomSource, /URL\.revokeObjectURL/u);
});

test('SCOUT badge zoom reuses a supported optimized detail artwork before enhancement', () => {
  assert.match(zoomSource, /const DETAIL_WIDTH = 1080;/u);
  assert.match(zoomSource, /const DETAIL_QUALITY = 85;/u);
  assert.ok(vercelConfig.images?.sizes?.includes(1080));
  assert.ok(vercelConfig.images?.qualities?.includes(85));
  assert.match(
    zoomSource,
    /const displayedSource = sourceImage\.currentSrc \|\| sourceImage\.src;/u
  );
  assert.match(
    zoomSource,
    /sourceImage\.getAttribute\('data-novelight-original-src'\)/u
  );
  assert.match(
    zoomSource,
    /optimizedScoutArtworkSource\(originalSource, ZOOM_WIDTH, ZOOM_QUALITY\)/u
  );
  assert.match(
    zoomSource,
    /if \(!enhancedSource \|\| originalSource\) return;/u
  );
});

test('SCOUT badge cards use a smaller optimized asset and prioritize the first visible batch', () => {
  assert.match(zoomSource, /const CARD_WIDTH = 256;/u);
  assert.match(zoomSource, /const CARD_QUALITY = 80;/u);
  assert.match(zoomSource, /const CARD_IMMEDIATE_COUNT = 8;/u);
  assert.ok(vercelConfig.images?.sizes?.includes(256));
  assert.ok(vercelConfig.images?.qualities?.includes(80));
  assert.match(zoomSource, /this\.loading = prioritized \? 'eager' : 'lazy';/u);
  assert.match(
    zoomSource,
    /this\.fetchPriority = prioritized \? 'high' : 'low';/u
  );
});
