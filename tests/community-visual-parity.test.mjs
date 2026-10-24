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
  assert.match(page, /novelight-header-light\.css/u);
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
  assert.match(css, /max-height: 47px !important/u);
  assert.match(css, /box-sizing: border-box !important/u);
  assert.match(css, /novelight-community-released/u);
  assert.match(read('novelight-client.js'), /novelight-community-released/u);
});

test('Home and plaza use the same card source of truth', () => {
  const home = read('index.html');
  const plaza = read('community.html');
  const link = 'data-novelight-community-card="shared"';
  for (const html of [home, plaza]) {
    assert.equal(html.split(link).length - 1, 1);
    assert.match(html, /novelight-community-card\.css/u);
  }
  const card = read('novelight-community-card.css');
  assert.match(card, /background: #102035/u);
  assert.match(card, /font-size: 22px/u);
  assert.match(card, /font-size: 20px/u);
  assert.match(card, /font-size: 19px/u);
  assert.match(card, /community-post-meta/u);
  assert.match(card, /community-actions/u);
  const ivory = read('novelight-community-ivory.css');
  assert.match(ivory, /background: #fffdf8/u);
  assert.match(ivory, /font-size: 17px/u);
  assert.match(ivory, /color: #302214/u);
  assert.ok(ivory.includes('.board-thread-card'));
  assert.doesNotMatch(ivory, /community-card-body/u);
  assert.doesNotMatch(ivory, /body\.novelight-page-community.*community-card/u);
});

test('Home and plaza do not branch card action positioning', () => {
  const script = read('novelight-community.js');
  assert.match(script, /meta\.append\(date, report\)/u);
  assert.doesNotMatch(script, /if \(isHome\) \{\s*actions\.append\(report\)/u);
});
test('new public pages have an enforced theme', () => {
  const pkg = JSON.parse(read('package.json'));
  const gate = read('scripts/check-public-page-standards.mjs');
  assert.match(pkg.scripts['header:check'], /check-public-page-standards/u);
  assert.ok(gate.includes('novelight-public-ivory'));
  assert.ok(gate.includes('novelight-header-light.css'));
  assert.ok(gate.includes('publicPageThemeExceptions'));
});
