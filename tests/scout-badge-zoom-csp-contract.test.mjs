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
  assert.doesNotMatch(imageDirective, /(?:^|\s)blob:(?:\s|$)/u);

  assert.match(zoomSource, /canvas\.toDataURL\('image\/png'\)/u);
  assert.doesNotMatch(zoomSource, /URL\.createObjectURL/u);
  assert.doesNotMatch(zoomSource, /URL\.revokeObjectURL/u);
});

test('SCOUT badge zoom falls back to the canonical artwork before enhancement', () => {
  assert.match(
    zoomSource,
    /zoomImage\.src = sourceImage\.currentSrc \|\| source;/u
  );
  assert.match(zoomSource, /if \(!enhancedSource\) return;/u);
});
