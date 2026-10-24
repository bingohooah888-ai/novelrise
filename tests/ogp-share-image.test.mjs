import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const imageFile = '../assets/ogp/novelight-ogp-1200x630.png';
const image = readFileSync(new URL(imageFile, import.meta.url));
const home = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const imageUrl = 'https://novelight.jp/assets/ogp/novelight-card-20261022.png';
const freshImage = readFileSync(
  new URL('../assets/ogp/novelight-card-20261022.png', import.meta.url)
);

test('approved NOVELIGHT OGP image is valid', () => {
  assert.equal(image.toString('hex', 0, 8), '89504e470d0a1a0a');
  assert.equal(image.readUInt32BE(16), 1200);
  assert.equal(image.readUInt32BE(20), 630);
  assert.equal(image.length, 1235931);
  const digest = createHash('sha256').update(image).digest('hex');
  assert.equal(
    digest,
    '4e36ebd5801a2d02fbcc469a4204ac6499658c8066d5012355e375a3c0dfc872'
  );
});

test('homepage uses approved OGP image', () => {
  const tags = [
    `property="og:image" content="${imageUrl}"`,
    `name="twitter:image" content="${imageUrl}"`,
    'name="twitter:card" content="summary_large_image"',
    'property="og:image:width" content="1200"',
    'property="og:image:height" content="630"',
    'property="og:image:type" content="image/png"'
  ];
  for (const tag of tags) {
    assert.ok(home.includes(tag), `Missing OGP tag: ${tag}`);
  }
});

test('retired share landing redirects home while keeping its approved X image', () => {
  assert.equal(existsSync(new URL('../welcome.html', import.meta.url)), false);
  const vercel = JSON.parse(
    readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')
  );
  for (const path of ['/welcome.html', '/welcome']) {
    const redirect = vercel.redirects.find((entry) => entry.source === path);
    assert.equal(redirect?.destination, 'https://novelight.jp/');
    assert.equal(redirect?.permanent, true);
  }
  assert.ok(
    freshImage.equals(image),
    'Keep the previously approved X card image without changes'
  );
});
