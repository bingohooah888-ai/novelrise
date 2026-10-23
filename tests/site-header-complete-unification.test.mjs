import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => readFileSync(path.join(root, name), 'utf8');
const htmlFiles = readdirSync(root).filter((name) => name.endsWith('.html'));
const HEADER_PATTERN = /<header\b[^>]*>[\s\S]*?<\/header>/u;
const client = read('novelight-client.js');
const publicCss = read('novelight-header-light.css');
const utilityCss = read('novelight-theme.css');

test('no root HTML page exposes the retired Features header link', () => {
  for (const page of htmlFiles) {
    const source = read(page);
    const header = source.match(HEADER_PATTERN)?.[0] || '';
    assert.doesNotMatch(header, /<a\b[^>]*>\s*特徴\s*<\/a>/u, page);
  }
  assert.doesNotMatch(client, /index\.html#features/u);
});

test('public headers use the five shared navigation links', () => {
  const labels = ['作品を探す', 'ランキング', '交流', 'お知らせ', '料金プラン'];
  let audited = 0;
  for (const page of htmlFiles) {
    if (page === 'scout-lv10-campaign.html') continue; // documented custom campaign header
    const header = read(page).match(HEADER_PATTERN)?.[0] || '';
    if (!header.includes('class="site-nav desktop-nav"')) continue;
    audited += 1;
    const desktop = header.split('class="site-nav desktop-nav"')[1];
    const mobile = header.split('aria-label="モバイルナビ"').slice(1);
    assert.ok(mobile.length >= 1, page);
    for (const block of [desktop, ...mobile]) {
      const nav = block.split('</nav>')[0];
      const items = Array.from(nav.matchAll(/>([^<]+)<\/a>/gu), (m) => m[1]);
      assert.deepEqual(items.slice(0, 5), labels, page);
      if (block === desktop) assert.equal(items.length, 5, page);
    }
  }
  assert.ok(audited >= 17, 'static public headers were audited');

  const shared = client.slice(
    client.indexOf('header.innerHTML ='),
    client.indexOf('return true;', client.indexOf('header.innerHTML ='))
  );
  let previous = -1;
  for (const label of labels) {
    const index = shared.indexOf(`>${label}</a>`);
    assert.ok(index > previous, label);
    previous = index;
  }
});

test('static public navigation does not silently lose its header', () => {
  for (const page of [
    'terms.html',
    'privacy.html',
    'billing-policy.html',
    'commerce-disclosure.html',
    'announcements.html',
    'operator.html'
  ]) {
    const source = read(page);
    const header = source.match(HEADER_PATTERN)?.[0];
    assert.ok(header, page);
    assert.match(header, /class="header-inner public-header-inner"/u, page);
    assert.match(header, /href="index\.html"/u, page);
    assert.match(header, /href="search\.html"/u, page);
    assert.match(header, /href="pricing\.html"/u, page);
    assert.match(header, /href="ranking\.html"/u, page);
    assert.match(source, /href="novelight-header-light\.css"/u, page);
  }
});

test('pre-registration content guidelines retain the isolated header', () => {
  const header = read('content-guidelines.html').match(HEADER_PATTERN)?.[0];
  assert.equal(
    header,
    '<header class="site-header" aria-label="NOVELIGHT"></header>'
  );
});

test('public campaign and audience pages load shared header geometry', () => {
  for (const page of [
    'author-features.html',
    'reader-features.html',
    'scout-lv10-campaign.html'
  ]) {
    assert.match(read(page), /href="novelight-header-light\.css"/u, page);
  }
});

test('one public header size system replaces the oversized Home logo', () => {
  assert.doesNotMatch(publicCss, /height: 156\.6px/u);
  assert.doesNotMatch(publicCss, /height: 135px/u);
  assert.doesNotMatch(
    publicCss,
    /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/u
  );
  assert.match(publicCss, /justify-content: space-evenly !important/u);
  for (const height of ['120px', '104.4px', '96px', '82.8px', '84px', '72px']) {
    assert.ok(publicCss.includes(height), height);
  }
  assert.match(publicCss, /font-size: 22px !important/u);
  assert.match(publicCss, /font-size: 20px !important/u);
});

test('utility header scale matches the public header without changing Admin', () => {
  assert.match(utilityCss, /header > \.header-inner/u);
  assert.match(utilityCss, /:not\(\.novelight-public-header-page\)/u);
  assert.match(utilityCss, /:not\(\.novelight-page-admin\)/u);
  assert.match(utilityCss, /:not\(\[class\*="novelight-page-admin-"\]\)/u);
  assert.match(utilityCss, /height: 104\.4px !important/u);
  assert.match(utilityCss, /min-height: 120px !important/u);
});
