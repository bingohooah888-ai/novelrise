import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const badgeAssets = [
  'assets/plan-badge-free.svg',
  'assets/plan-badge-standard.svg',
  'assets/plan-badge-premium.svg'
];

test('public brand refinement is wired', async () => {
  const pricing = await read('pricing.html');
  const home = await read('index.html');

  assert.match(pricing, /novelight-brand-refinement\.css/);
  assert.match(home, /novelight-brand-refinement\.css/);
  assert.match(pricing, /assets\/novelight-header-logo\.webp/);
  assert.match(home, /assets\/novelight-header-logo\.webp/);
});

test('home and pricing use the approved plan badge artwork', async () => {
  const pricing = await read('pricing.html');
  const home = await read('index.html');
  const brandCss = await read('novelight-brand-refinement.css');
  const badgeCss = await read('novelight-plan-badges.css');

  assert.match(pricing, /plan-emblem free-emblem/);
  assert.match(pricing, /plan-emblem standard-emblem/);
  assert.match(pricing, /plan-emblem premium-emblem/);
  assert.match(home, /class="plans"/);
  assert.match(brandCss, /@import url\("novelight-plan-badges\.css"\)/);
  assert.doesNotMatch(brandCss, /Ornate compass medallions built in CSS/);
  assert.match(badgeCss, /assets\/plan-badge-free\.svg/);
  assert.match(badgeCss, /assets\/plan-badge-standard\.svg/);
  assert.match(badgeCss, /assets\/plan-badge-premium\.svg/);
  assert.match(badgeCss, /novelight-page-index[^}]*\.plans > \.plan::before/s);

  for (const assetPath of badgeAssets) {
    const asset = await read(assetPath);
    assert.match(asset, /data:image\/webp;base64,/);
  }
});

test('pricing typography raises legibility', async () => {
  const css = await read('novelight-brand-refinement.css');

  assert.match(css, /text-decoration:\s*none/);
  assert.match(css, /font-size:\s*16px/);
  assert.match(css, /font-size:\s*50px/);
  assert.match(css, /--brand-display-font/);
});

test('billing actions keep the existing endpoints', async () => {
  const pricing = await read('pricing.html');

  assert.match(pricing, /\/api\/activate-beta-standard/);
  assert.match(pricing, /\/api\/create-checkout-session/);
  assert.match(pricing, /login\.html\?redirect=pricing\.html/);
});
