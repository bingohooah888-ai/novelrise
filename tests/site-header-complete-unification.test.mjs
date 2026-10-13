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

test('public navigation has four links in both layouts', () => {
  const expected = [
    ['search.html', '作品を探す'],
    ['ranking.html', 'ランキング'],
    ['announcements.html', 'お知らせ'],
    ['pricing.html', '料金プラン']
  ];

  const DESKTOP_NAV =
    /<nav class="site-nav desktop-nav"[^>]*>([\s\S]*?)<\/nav>/u;
  const MOBILE_NAV = /<nav aria-label="モバイルナビ">([\s\S]*?)<\/nav>/gu;
  const NAV_ANCHORS = /<a\b[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gu;
  let audited = 0;
  for (const page of htmlFiles) {
    const header = read(page).match(HEADER_PATTERN)?.[0] || '';
    const primary = header.match(DESKTOP_NAV);
    if (!primary) continue;
    audited += 1;

    const mobileMatches = Array.from(header.matchAll(MOBILE_NAV));
    const navBlocks = [primary[1], ...mobileMatches.map((m) => m[1])];
    assert.ok(navBlocks.length >= 2, page);

    for (const nav of navBlocks) {
      const matches = Array.from(nav.matchAll(NAV_ANCHORS));
      const items = matches.map((m) => [m[1], m[2]]);
      assert.deepEqual(items.slice(0, 4), expected, page);
      assert.ok(
        items.slice(4).every(([, label]) =>
          ['ログイン', '会員登録', 'SCOUT RECORD', 'マイページ'].includes(label)
        ),
        `${page}: unexpected extra navigation items`
      );
    }
  }
  assert.ok(audited >= 17, 'all static public headers were audited');
  assert.match(client, /href="announcements\.html"/u);
  const shared = client.slice(
    client.indexOf('header.innerHTML ='),
    client.indexOf('return true;', client.indexOf('header.innerHTML ='))
  );
  for (const [, label] of expected) {
    assert.equal(shared.split(`>${label}</a>`).length - 1, 2);
  }
  const first = expected.map(([, label]) => shared.indexOf(`>${label}</a>`));
  assert.ok(first.every((offset, i) => i === 0 || offset > first[i - 1]));
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
