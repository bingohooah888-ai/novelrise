import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import middleware, { config as middlewareConfig } from '../middleware.js';
import { URL } from 'node:url';

const imageFile = '../assets/ogp/novelight-ogp-1200x630.png';
const image = readFileSync(new URL(imageFile, import.meta.url));
const home = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const imageUrl =
  'https://novelight.jp/assets/ogp/novelight-card-20261022.png?home_card=20261026';
const welcome = readFileSync(
  new URL('../welcome.html', import.meta.url),
  'utf8'
);
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

test('Twitterbot gets the large card from middleware at the root URL', async () => {
  assert.equal(middlewareConfig.matcher, '/');
  const response = middleware(
    new globalThis.Request('https://novelight.jp/', {
      headers: { 'user-agent': 'Twitterbot/1.0' }
    })
  );
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('x-novelight-card-route'),
    'twitterbot-home-middleware-v1'
  );
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const html = await response.text();
  assert.match(html, /name="twitter:card" content="summary_large_image"/u);
  assert.match(html, /property="og:url" content="https:\/\/novelight\.jp\/"/u);
  assert.ok(html.includes(`name="twitter:image" content="${imageUrl}"`));
  assert.match(html, /property="og:image:width" content="1200"/u);
  assert.match(html, /property="og:image:height" content="630"/u);
});

test('routing middleware does not change normal visitors or other pages', () => {
  const requests = [
    new globalThis.Request('https://novelight.jp/', {
      headers: { 'user-agent': 'Mozilla/5.0' }
    }),
    new globalThis.Request('https://novelight.jp/index.html', {
      headers: { 'user-agent': 'Twitterbot/1.0' }
    }),
    new globalThis.Request('https://novelight.jp/search.html', {
      headers: { 'user-agent': 'Twitterbot/1.0' }
    })
  ];
  for (const request of requests) {
    assert.equal(middleware(request), undefined);
  }
  const config = JSON.parse(
    readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')
  );
  assert.ok(!config.rewrites.some((route) => route.source === '/'));
});

test('homepage social metadata precedes startup scripts', () => {
  const twitterCard = home.indexOf('name="twitter:card"');
  const startup = home.indexOf('novelightContestGatePrefetch');
  assert.ok(twitterCard > 0 && twitterCard < startup);
  assert.equal(home.match(/name="twitter:card"/gu)?.length, 1);
  const canonical = 'property="og:url" content="https://novelight.jp/"';
  assert.ok(home.includes(canonical));
  const imageTag = `name="twitter:image" content="${imageUrl}"`;
  assert.ok(home.includes(imageTag));
});

test('legacy welcome URL keeps its original X card and canonical metadata', () => {
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
  assert.ok(
    freshImage.equals(image),
    'Versioned sharing image must be exact approved PNG'
  );
});

test('welcome URL serves its X card while browsers go directly to the homepage', () => {
  const redirect = "window.location.replace('/');";
  assert.ok(
    welcome.includes(redirect),
    'The browser must skip the welcome screen'
  );
  assert.ok(
    welcome.indexOf('name="twitter:image"') < welcome.indexOf(redirect),
    'X card metadata must precede any browser redirect'
  );
  assert.doesNotMatch(welcome, /<meta\s+http-equiv=["']refresh/i);

  const config = JSON.parse(
    readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')
  );
  assert.ok(
    !config.redirects.some(({ source }) =>
      ['/welcome', '/welcome.html'].includes(source)
    ),
    'HTTP redirects would prevent X from reading the welcome OGP metadata'
  );
});

test('X marketing share URL stays separate from work links', () => {
  const homeUrl = 'https://novelight.jp/';
  assert.ok(home.includes(`href="${homeUrl}"`));
  assert.ok(home.includes(`property="og:url" content="${homeUrl}"`));

  const sources = [
    '../novelight-public-share.js',
    '../novelight-x-image-share.js',
    '../novelight-share-attribution-lite.js'
  ];
  for (const path of sources) {
    const code = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.ok(!code.includes('welcome.html'), path);
  }

  const note = readFileSync(
    new URL('../docs/marketing/LINK-DESTINATIONS.md', import.meta.url),
    'utf8'
  );
  const rule = note.split('\n').find((line) => line.includes('一般向けX投稿'));
  assert.ok(rule?.includes('https://novelight.jp/welcome.html'));
  assert.match(note, /X投稿以外のリンク・個別ページ/u);
  assert.match(note, /既存のX投稿・DMの保護/u);
});
