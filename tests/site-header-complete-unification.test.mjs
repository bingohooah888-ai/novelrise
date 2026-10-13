import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => readFileSync(path.join(root, name), 'utf8');
const htmlFiles = readdirSync(root).filter((name) => name.endsWith('.html'));
const client = read('novelight-client.js');
const publicCss = read('novelight-header-light.css');
const utilityCss = read('novelight-theme.css');

test('no root HTML page exposes the retired Features header link', () => {
  for (const page of htmlFiles) {
    const source = read(page);
    const header = source.match(/<header\b[^>]*>[\s\S]*?<\/header>/u)?.[0] || '';
    assert.doesNotMatch(
      header,
      /<a\b[^>]*>\s*特徴\s*<\/a>/u,
      page
    );
  }
  assert.doesNotMatch(client, /index\.html#features/u);
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
    const header = source.match(/<header\b[^>]*>[\s\S]*?<\/header>/u)?.[0];
    assert.ok(header, page);
    assert.match(header, /class="header-inner public-header-inner"/u, page);
    assert.match(header, /href="index\.html"/u, page);
    assert.match(header, /href="search\.html"/u, page);
    assert.match(header, /href="pricing\.html"/u, page);
    assert.match(header, /href="ranking\.html"/u, page);
    assert.match(source, /href="novelight-header-light\.css"/u, page);
  }
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
