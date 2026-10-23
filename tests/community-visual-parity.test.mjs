import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = (file) =>
  readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const header = (html) =>
  html.match(/<header class="site-header">[\s\S]*?<\/header>/u)?.[0];

test('plaza has exactly the Home header at first paint', () => {
  const plaza = read('community.html');
  assert.equal(header(plaza), header(read('index.html')));
  assert.match(plaza, /novelight-public-header-page novelight-public-ivory/u);
  assert.doesNotMatch(plaza, /novelight-public-dark/u);
  assert.match(plaza, /novelight-community-ivory\.css/u);
  assert.match(plaza, /shared\/page\/public-ivory\.css/u);
  assert.match(plaza, /data-novelight-shared-header="true"/u);
});

test('plaza syncs its logged-in account navigation via shared client', () => {
  assert.match(
    read('novelight-community.js'),
    /NovelightClient\?\.syncAuthHeader\(client\)/u
  );
  assert.match(
    read('novelight-client.js'),
    /function syncAuthHeader\(client\)/u
  );
});

test(
  'navigation is a single row on desktop and switches to menu on narrow screens',
  () => {
    const shared = read('shared/header/public-header.html');
    assert.equal((shared.match(/href="community\.html"/gu) || []).length, 2);
    const css = read('shared/header/public-header.css');
    assert.match(css, /flex-wrap: nowrap !important/u);
    assert.match(css, /max-width: 1510px/u);
    assert.match(css, /mobile-menu/u);
  }
);

test('community and board read clearly on ivory backgrounds', () => {
  const css = read('novelight-community-ivory.css');
  for (const selector of [
    '.community-page h1',
    '.community-card-body',
    '.community-date',
    '.board-thread-card',
    '.board-compose'
  ]) {
    assert.ok(css.includes(selector), selector);
  }
  assert.match(css, /background: #fffdf8/u);
  assert.match(css, /font-size: 17px/u);
  assert.match(css, /color: #302214/u);
});

test('new public pages use the shared header and ivory style', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(
    pkg.scripts['header:check'],
    /check-public-page-standards\.mjs/u
  );
  const gate = read('scripts/check-public-page-standards.mjs');
  for (const fragment of [
    'manifest.managed.includes(page)',
    'novelight-public-header-page',
    'novelight-public-ivory',
    'data-novelight-shared-header',
    'publicPageThemeExceptions'
  ]) {
    assert.ok(gate.includes(fragment), fragment);
  }
});
