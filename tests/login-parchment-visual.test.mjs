import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const login = read('login.html');
const headerCss = read('novelight-header-light.css');
const brandCss = read('novelight-brand-refinement.css');
const css = read('novelight-login-parchment.css');

const ruleBody = (source, selector) => {
  const start = source.indexOf(selector);
  assert.notEqual(start, -1, `${selector} must exist`);
  const open = source.indexOf('{', start);
  const close = source.indexOf('}', open);
  return source.slice(open + 1, close);
};

test('login keeps auth wiring', () => {
  assert.ok(login.includes('id="loginForm"'));
  assert.ok(login.includes('safeRedirectTarget'));
  assert.ok(login.includes('signInWithPassword'));
});

test('login loads the parchment visual layer', () => {
  assert.ok(headerCss.includes('novelight-login-parchment.css'));
  assert.ok(css.includes('#f1e5c9'));
  assert.ok(css.includes('#e6d3ad'));
  assert.ok(css.includes('#dcc294'));
  assert.ok(css.includes('#3a2618'));
  assert.ok(css.includes('header.site-header'));
  assert.ok(css.includes('height: auto !important'));
  assert.ok(css.includes('linear-gradient(135deg, #4b3021, #745034)'));
});

test('login typography uses Home brand fonts', () => {
  assert.ok(brandCss.includes('--brand-display-font: "Yu Mincho"'));
  assert.ok(brandCss.includes('--brand-reading-font: "Yu Mincho"'));
  assert.ok(css.includes('--brand-display-font: "Yu Mincho"'));
  assert.ok(css.includes('--brand-reading-font: "Yu Mincho"'));
  assert.ok(css.includes('font-family: var(--brand-reading-font);'));
  assert.ok(css.includes('font-family: var(--brand-display-font);'));
  assert.ok(!css.includes('BlinkMacSystemFont'));
});

test('shared public navigation typography is enlarged by two steps', () => {
  const desktopNav = ruleBody(
    headerCss,
    'html body.novelight-public-header-page:not(.novelight-public-dark) .site-nav a'
  );
  const mobileNav = ruleBody(
    headerCss,
    'html body.novelight-public-header-page:not(.novelight-public-dark) .mobile-menu > nav a'
  );

  assert.ok(desktopNav.includes('font-size: 22px !important;'));
  assert.ok(mobileNav.includes('font-size: 20px !important;'));
});

test('login card typography is enlarged by two steps', () => {
  assert.ok(ruleBody(css, 'html body.novelight-page-login h1').includes('font-size: 36px;'));
  assert.ok(ruleBody(css, 'html body.novelight-page-login .lead').includes('font-size: 20px;'));
  assert.ok(ruleBody(css, 'html body.novelight-page-login label').includes('font-size: 19px;'));
  assert.ok(ruleBody(css, 'html body.novelight-page-login input').includes('font-size: 20px;'));
  assert.ok(
    ruleBody(css, 'html body.novelight-page-login button {\n  min-height').includes('font-size: 20px;')
  );
  assert.ok(ruleBody(css, 'html body.novelight-page-login .row').includes('font-size: 18px;'));
  assert.ok(ruleBody(css, 'html body.novelight-page-login .status').includes('font-size: 18px;'));
  assert.ok(ruleBody(css, 'html body.novelight-page-login .legal').includes('font-size: 16px;'));
  assert.ok(css.includes('font-size: 33px;'));
});
