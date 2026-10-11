import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const home = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const head = home.slice(0, home.indexOf('</head>'));
const canonical = 'https://novelight.jp/';

test('home page provides Japanese and Latin brand search signals', () => {
  assert.match(head, /<title>NOVELIGHT（ノベライト）/u);
  assert.match(head, /<meta name="description" content="[^"]*ノベライト[^"]*小説/u);
  assert.match(home, /<h1>NOVELIGHT（ノベライト）｜小説投稿サイト<\/h1>/u);
});

test('home page consistently specifies canonical domain', () => {
  assert.match(head, /<link rel="canonical" href="https:\/\/novelight\.jp\/"/u);
  assert.match(head, /<meta property="og:url" content="https:\/\/novelight\.jp\/"/u);
  assert.ok(!head.includes('noindex'));
});

test('home page provides parseable WebSite name with alternative name', () => {
  const block = head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/u);
  assert.ok(block, 'missing WebSite schema');
  const data = JSON.parse(block[1]);
  assert.equal(data['@type'], 'WebSite');
  assert.equal(data.name, 'NOVELIGHT');
  assert.equal(data.alternateName, 'ノベライト');
  assert.equal(data.url, canonical);
});

test('homepage metadata and sitemap agree on canonical domain', () => {
  const robots = readFileSync(fileURLToPath(new URL('../robots.txt', import.meta.url)), 'utf8');
  const sitemap = readFileSync(fileURLToPath(new URL('../sitemap.xml', import.meta.url)), 'utf8');
  assert.match(robots, /Sitemap: https:\/\/novelight\.jp\/sitemap\.xml/u);
  assert.match(sitemap, /https:\/\/novelight\.jp\/api\/sitemap/u);
});

test('all core sitemap destinations use the canonical novelight.jp URL', () => {
  const coreRoutes = [
    ['search.html', 'https://novelight.jp/search.html'],
    ['ranking.html', 'https://novelight.jp/ranking.html'],
    ['pricing.html', 'https://novelight.jp/pricing.html'],
    ['beta-authors.html', 'https://novelight.jp/beta-authors']
  ];
  for (const [file, url] of coreRoutes) {
    const page = readFileSync(fileURLToPath(new URL('../' + file, import.meta.url)), 'utf8');
    const pageHead = page.slice(0, page.indexOf('</head>'));
    assert.ok(pageHead.includes('<link rel="canonical" href="' + url + '">'), file);
    assert.match(pageHead, /<title>[^<]*ノベライト/u, file);
  }
});
