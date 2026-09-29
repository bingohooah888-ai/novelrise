import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [api, wrapper, browser] = await Promise.all([
  readFile('api/_lib/thumbnail-render.js', 'utf8'),
  readFile('api/thumbnail-render.js', 'utf8'),
  readFile('novelight-thumbnail-composer.js', 'utf8')
]);

const EIGHT_MIB = '8 * 1024 * 1024';

test('thumbnail render upload limit matches the 8 MiB Storage contract', () => {
  assert.match(api, new RegExp(`const MAX_RENDER_SIZE = ${EIGHT_MIB.replaceAll('*', '\\*')}`));
  assert.match(api, /fileSize > MAX_RENDER_SIZE/u);
  assert.match(api, /maxFileSize: MAX_RENDER_SIZE/u);
});

test('browser sends the actual render Blob size without a client-side 2 MiB cap', () => {
  assert.match(browser, /fileSize: blob\.size/u);
  assert.doesNotMatch(browser, /2\s*\*\s*1024\s*\*\s*1024/u);
});

test('legacy iPhone rewrite is inert until its dedicated removal step', () => {
  assert.match(wrapper, /const LEGACY_RENDER_LIMIT = 8 \* 1024 \* 1024/u);
  assert.match(wrapper, /const IOS_RENDER_LIMIT = 8 \* 1024 \* 1024/u);
  assert.match(wrapper, /fileSize > LEGACY_RENDER_LIMIT[\s\S]*fileSize <= IOS_RENDER_LIMIT/u);
  assert.doesNotMatch(wrapper, /const LEGACY_RENDER_LIMIT = 2 \* 1024 \* 1024/u);
});
