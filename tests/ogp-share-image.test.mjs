import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const image = readFileSync(
  new URL('../assets/ogp/novelight-ogp-1200x630.png', import.meta.url)
);
const homepage = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const imageUrl = 'https://novelight.jp/assets/ogp/novelight-ogp-1200x630.png';

test('approved NOVELIGHT social sharing image is the original 1200x630 PNG', () => {
  assert.equal(image.toString('hex', 0, 8), '89504e470d0a1a0a');
  assert.equal(image.readUInt32BE(16), 1200);
  assert.equal(image.readUInt32BE(20), 630);
  assert.equal(image.length, 1235931);
  assert.equal(
    createHash('sha256').update(image).digest('hex'),
    '4e36ebd5801a2d02fbcc469a4204ac6499658c8066d5012355e375a3c0dfc872'
  );
});

test('homepage Open Graph and X tags use the approved image', () => {
  assert.ok(homepage.includes(`property="og:image" content="${imageUrl}"`));
  assert.ok(homepage.includes(`name="twitter:image" content="${imageUrl}"`));
  assert.ok(homepage.includes('name="twitter:card" content="summary_large_image"'));
  assert.ok(homepage.includes('property="og:image:width" content="1200"'));
  assert.ok(homepage.includes('property="og:image:height" content="630"'));
  assert.ok(homepage.includes('property="og:image:type" content="image/png"'));
});
