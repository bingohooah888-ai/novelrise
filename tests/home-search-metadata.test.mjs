import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
function read(path) {
  return readFileSync(fileURLToPath(new URL(path, root)), 'utf8');
}

const home = read('index.html');
const head = home.split('</head>')[0];

test('home page provides Japanese and Latin brand search signals', () => {
  assert.match(head, /<title>NOVELIGHT（ノベライト）/u);
  assert.match(
    head,
    /<meta name="description" content="[^"]*ノベライト[^"]*小説/u
  );
  assert.match(home, /<h1 class="home-heading-a11y">NOVELIGHT（ノベライト）｜小説投稿サイト<\/h1>/u);
});

test('home page consistently specifies canonical domain', () => {
  assert.ok(
    head.includes('<link rel="canonical" href="https://novelight.jp/">')
  );
  assert.ok(
    head.includes('<meta property="og:url" content="https://novelight.jp/">')
  );
  assert.ok(!head.includes('noindex'));
});

test('home page provides parseable WebSite name with alternative name', () => {
  const block = head.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/u
  );
  assert.ok(block, 'missing WebSite schema');
  const data = JSON.parse(block[1]);
  assert.equal(data['@type'], 'WebSite');
  assert.equal(data.name, 'NOVELIGHT');
  assert.equal(data.alternateName, 'ノベライト');
  assert.equal(data.url, 'https://novelight.jp/');
});

test('homepage metadata and sitemap agree on canonical domain', () => {
  assert.match(
    read('robots.txt'),
    /Sitemap: https:\/\/novelight\.jp\/sitemap\.xml/u
  );
  assert.match(read('sitemap.xml'), /https:\/\/novelight\.jp\/api\/sitemap/u);
});

test('all core sitemap destinations use the canonical novelight.jp URL', () => {
  const coreRoutes = [
    ['search.html', 'https://novelight.jp/search.html'],
    ['ranking.html', 'https://novelight.jp/ranking.html'],
    ['pricing.html', 'https://novelight.jp/pricing.html'],
    ['beta-authors.html', 'https://novelight.jp/beta-authors']
  ];
  for (const [file, url] of coreRoutes) {
    const pageHead = read(file).split('</head>')[0];
    assert.ok(pageHead.includes(`<link rel="canonical" href="${url}">`), file);
    assert.match(pageHead, /<title>[^<]*ノベライト/u, file);
  }
});
