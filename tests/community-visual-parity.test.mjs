import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

function read(file) {
  return readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
}

function header(html) {
  const match = html.match(/<header class="site-header">[\s\S]*?<\/header>/u);
  return match?.[0];
}

test('community shares the Home header', () => {
  const page = read('community.html');
  assert.equal(header(page), header(read('index.html')));
  assert.match(page, /novelight-public-header-page novelight-public-ivory/u);
  assert.doesNotMatch(page, /novelight-public-dark/u);
  assert.match(page, /novelight-community-ivory\.css/u);
  assert.match(page, /shared\/page\/public-ivory\.css/u);
});

test('community shares login state', () => {
  const runtime = read('novelight-community.js');
  assert.match(runtime, /NovelightClient\?\.syncAuthHeader\(client\)/u);
});

test('four navigation links never wrap', () => {
  const shared = read('shared/header/public-header.html');
  const css = read('shared/header/public-header.css');
  assert.equal((shared.match(/href="community\.html"/gu) || []).length, 2);
  assert.match(css, /flex-wrap: nowrap !important/u);
  assert.match(css, /max-width: 1510px/u);
  assert.match(css, /novelight-community-released/u);
  assert.match(read('novelight-client.js'), /novelight-community-released/u);
});

test('plaza and board use readable ivory', () => {
  const css = read('novelight-community-ivory.css');
  assert.match(css, /background: #fffdf8/u);
  assert.match(css, /font-size: 17px/u);
  assert.match(css, /color: #302214/u);
  assert.match(css, /background: #102035/u);
  assert.match(css, /community-post-meta/u);
  assert.ok(css.includes('.board-thread-card'));
});

test('new public pages have an enforced theme', () => {
  const pkg = JSON.parse(read('package.json'));
  const gate = read('scripts/check-public-page-standards.mjs');
  assert.match(pkg.scripts['header:check'], /check-public-page-standards/u);
  assert.ok(gate.includes('novelight-public-ivory'));
  assert.ok(gate.includes('publicPageThemeExceptions'));
});
