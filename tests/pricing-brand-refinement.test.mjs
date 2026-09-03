import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const embeddedBadgeAssets = ['assets/plan-badge-standard.svg'];
const directWebpBadgeAssets = [
  'assets/plan-badge-free.webp',
  'assets/plan-badge-premium.webp'
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
  assert.match(badgeCss, /assets\/plan-badge-free\.webp/);
  assert.match(badgeCss, /assets\/plan-badge-standard\.svg/);
  assert.match(badgeCss, /assets\/plan-badge-premium\.webp/);
  assert.doesNotMatch(badgeCss, /assets\/plan-badge-(?:free|premium)\.svg/);
  assert.match(badgeCss, /novelight-page-index[^}]*\.plans > \.plan::before/s);
  assert.match(
    badgeCss,
    /\.plans > \.plan::before\s*\{[^}]*position:\s*static;[^}]*inset:\s*auto;[^}]*flex:\s*0 0 auto;/s
  );
  assert.match(
    badgeCss,
    /novelight-page-pricing \.plan-emblem\s*\{[^}]*width:\s*264px;[^}]*height:\s*264px;/s
  );
  assert.match(
    badgeCss,
    /novelight-page-index\.novelight-public-dark \.plans > \.plan::before\s*\{[^}]*width:\s*225px;[^}]*height:\s*225px;/s
  );
  assert.match(badgeCss, /plan-emblem \{ width:\s*207px; height:\s*207px; \}/);
  assert.match(
    badgeCss,
    /\.plans > \.plan::before \{ width:\s*189px; height:\s*189px; \}/
  );

  for (const assetPath of embeddedBadgeAssets) {
    const asset = await read(assetPath);
    assert.match(asset, /data:image\/webp;base64,/);
  }

  for (const assetPath of directWebpBadgeAssets) {
    const asset = await readFile(new URL(assetPath, root));
    assert.equal(asset.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(asset.subarray(8, 12).toString('ascii'), 'WEBP');
    assert.equal(asset.readUInt32LE(4) + 8, asset.length);
  }
});

test('desktop pricing cards align plan rows and use a two-by-two feature grid', async () => {
  const badgeCss = await read('novelight-plan-badges.css');

  assert.match(
    badgeCss,
    /@media \(min-width: 901px\)[\s\S]*?\.pricing-card\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:/s
  );
  assert.match(
    badgeCss,
    /@media \(min-width: 901px\)[\s\S]*?\.plan-emblem\s*\{[^}]*width:\s*189px;[^}]*height:\s*189px;/s
  );
  assert.match(
    badgeCss,
    /@media \(min-width: 901px\)[\s\S]*?\.features\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s
  );
  assert.match(badgeCss, /\.name\s*\{[^}]*font-size:\s*32px;/s);
  assert.match(badgeCss, /\.desc\s*\{[^}]*font-size:\s*17px;/s);
  assert.match(badgeCss, /\.price\s*\{[^}]*font-size:\s*50px;/s);
  assert.match(badgeCss, /\.features li\s*\{[^}]*font-size:\s*16px;/s);
});

test('pricing feature copy wraps by phrases with a hanging checkmark indent', async () => {
  const badgeCss = await read('novelight-plan-badges.css');

  assert.match(
    badgeCss,
    /novelight-page-pricing\.novelight-public-dark \.features li\s*\{[^}]*position:\s*relative;[^}]*padding-left:\s*1\.45em;[^}]*word-break:\s*auto-phrase;/s
  );
  assert.match(
    badgeCss,
    /novelight-page-pricing\.novelight-public-dark \.features li::before\s*\{[^}]*position:\s*absolute;[^}]*left:\s*0;[^}]*margin-right:\s*0;/s
  );
  assert.match(
    badgeCss,
    /@media \(min-width: 901px\)[\s\S]*?\.features li\s*\{[^}]*padding:\s*8px 0 8px 1\.45em;/s
  );
});

test('pricing typography raises legibility', async () => {
  const css = await read('novelight-brand-refinement.css');

  assert.match(css, /text-decoration:\s*none/);
  assert.match(css, /font-size:\s*16px/);
  assert.match(css, /font-size:\s*50px/);
  assert.match(css, /--brand-display-font/);
});

test('billing actions keep the existing endpoints and concise Premium CTA', async () => {
  const pricing = await read('pricing.html');

  assert.match(pricing, /\/api\/activate-beta-standard/);
  assert.match(pricing, /\/api\/create-checkout-session/);
  assert.match(pricing, /login\.html\?redirect=pricing\.html/);
  assert.match(pricing, /<button id="premium" class="paid premium-button">Premiumを申し込む<\/button>/);
  assert.match(pricing, /PREMIUM_LABEL='Premiumを申し込む'/);
  assert.doesNotMatch(pricing, /Premiumを申し込む \/ 管理/);
});
