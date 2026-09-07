import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const themeEntry = readFileSync(join(root, 'novelight-theme.css'), 'utf8');
const fontLayer = readFileSync(
  join(root, 'novelight-font-unification.css'),
  'utf8'
);
const legal = readFileSync(join(root, 'legal.css'), 'utf8');

const homepageFontTokens = [
  '"Yu Mincho"',
  '"Hiragino Mincho ProN"',
  '"Hiragino Mincho Pro"',
  '"Noto Serif JP"',
  '"Noto Serif CJK JP"'
];

test('sitewide font layer loads after legacy surface overrides', () => {
  const legacyIndex = themeEntry.indexOf(
    '@import url("novelight-legacy-surfaces.css")'
  );
  const fontIndex = themeEntry.indexOf(
    '@import url("novelight-font-unification.css")'
  );
  assert.ok(legacyIndex >= 0);
  assert.ok(fontIndex > legacyIndex);
});

test('sitewide typography uses the homepage Mincho brand stack for body and controls', () => {
  for (const token of homepageFontTokens) {
    assert.match(fontLayer, new RegExp(token, 'u'));
  }
  assert.match(fontLayer, /html body\.novelight-theme \{/u);
  assert.match(
    fontLayer,
    /font-family: var\(--novelight-brand-reading-font\) !important;/u
  );
  assert.match(fontLayer, /button,/u);
  assert.match(fontLayer, /input,/u);
  assert.match(fontLayer, /select,/u);
  assert.match(fontLayer, /textarea,/u);
  assert.match(fontLayer, /\.site-nav a,/u);
  assert.match(fontLayer, /\.back,/u);
  assert.match(fontLayer, /\.btn,/u);
  assert.match(fontLayer, /\.card-cta,/u);
  assert.match(fontLayer, /\.logout,/u);
});

test('the specifically requested creator and profile pages receive the sitewide theme', () => {
  for (const page of [
    'mypage.html',
    'post.html',
    'my-novels.html',
    'analytics.html',
    'scout-record.html',
    'author.html'
  ]) {
    const html = readFileSync(join(root, page), 'utf8');
    assert.match(
      html,
      /novelight-client\.js|href="novelight-theme\.css"/u,
      page
    );
  }
});

test('static legal surfaces use the same homepage font instead of the old sans stack', () => {
  for (const token of homepageFontTokens) {
    assert.match(legal, new RegExp(token, 'u'));
  }
  assert.match(legal, /font-family: var\(--brand-reading-font\);/u);
  assert.match(legal, /font-family: var\(--brand-display-font\);/u);
  assert.doesNotMatch(legal, /"Noto Sans JP"/u);
  assert.doesNotMatch(legal, /BlinkMacSystemFont/u);
});

test('creator content-warning checkboxes are reset from the legacy 46px input height', () => {
  assert.match(
    fontLayer,
    /body:is\(\.novelight-page-post, \.novelight-page-novel-edit\)/u
  );
  assert.match(fontLayer, /input\[type="checkbox"\]/u);
  assert.match(fontLayer, /width: 16px !important;/u);
  assert.match(fontLayer, /height: 16px !important;/u);
  assert.match(fontLayer, /min-height: 0 !important;/u);
  assert.match(fontLayer, /flex: 0 0 16px;/u);
  assert.match(fontLayer, /margin: 3px 0 0 !important;/u);
});
