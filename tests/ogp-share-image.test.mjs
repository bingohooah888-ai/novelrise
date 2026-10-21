import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const imageFile = '../assets/ogp/novelight-ogp-1200x630.png';
const image = readFileSync(new URL(imageFile, import.meta.url));
const home = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const imageUrl = 'https://novelight.jp/assets/ogp/novelight-card-20261022.png';
const welcome = readFileSync(new URL('../welcome.html', import.meta.url), 'utf8');
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

test('new share URL has its own X card and canonical metadata', () => {
  const tags = [
    'href="https://novelight.jp/welcome.html"',
    'property="og:url" content="https://novelight.jp/welcome.html"',
    'name="twitter:card" content="summary_large_image"',
    'name="twitter:image" content="https://novelight.jp/assets/ogp/novelight-card-20261022.png"',
    'property="og:image" content="https://novelight.jp/assets/ogp/novelight-card-20261022.png"',
    'name="twitter:site" content="@NOVELIGHT_jp"'
  ];
  for (const tag of tags) {
    assert.ok(welcome.includes(tag), `Missing welcome tag: ${tag}`);
  }
  assert.ok(freshImage.equals(image), 'Versioned sharing image must be exact approved PNG');
});
