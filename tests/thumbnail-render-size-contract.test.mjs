import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [api, wrapper, browser] = await Promise.all([
  readFile('api/_lib/thumbnail-render.js', 'utf8'),
  readFile('api/thumbnail-render.js', 'utf8'),
  readFile('novelight-thumbnail-composer.js', 'utf8')
]);

test('thumbnail render upload limit matches the 8 MiB Storage contract', () => {
  assert.match(api, /const MAX_RENDER_SIZE = 8 \* 1024 \* 1024/u);
  assert.match(api, /fileSize > MAX_RENDER_SIZE/u);
  assert.match(api, /maxFileSize: MAX_RENDER_SIZE/u);
});

test('browser sends the actual render Blob size without a client-side 2 MiB cap', () => {
  assert.match(browser, /fileSize: blob\.size/u);
  assert.doesNotMatch(browser, /2\s*\*\s*1024\s*\*\s*1024/u);
});

test('all clients use the same thumbnail render handler without UA-specific exceptions', () => {
  assert.match(wrapper, /return handler\(req, res\);/u);
  assert.doesNotMatch(wrapper, /iPhone/iu);
  assert.doesNotMatch(wrapper, /user-agent/iu);
  assert.doesNotMatch(wrapper, /LEGACY_RENDER_LIMIT|IOS_RENDER_LIMIT/u);
});

test('WebP and PNG share the same API size contract', () => {
  assert.match(api, /'image\/webp': 'webp'/u);
  assert.match(api, /'image\/png': 'png'/u);
  assert.match(api, /fileSize > MAX_RENDER_SIZE/u);
});
