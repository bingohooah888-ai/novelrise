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

const fontVariable = (source, name) => {
  const match = source.match(new RegExp(`${name}:\\s*([^;]+);`));
  assert.ok(match, `${name} must be defined`);
  return match[1].replace(/\s+/g, ' ').trim();
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

test('login typography uses the same brand font system as Home', () => {
  assert.equal(
    fontVariable(css, '--brand-display-font'),
    fontVariable(brandCss, '--brand-display-font')
  );
  assert.equal(
    fontVariable(css, '--brand-reading-font'),
    fontVariable(brandCss, '--brand-reading-font')
  );
  assert.ok(css.includes('font-family: var(--brand-reading-font);'));
  assert.ok(css.includes('font-family: var(--brand-display-font);'));
  assert.ok(css.includes('html body.novelight-page-login .site-nav a'));
  assert.ok(css.includes('html body.novelight-page-login .btn'));
  assert.ok(css.includes('html body.novelight-page-login button'));
  assert.ok(css.includes('"Yu Mincho"'));
  assert.ok(css.includes('"Hiragino Mincho ProN"'));
  assert.ok(css.includes('"Noto Serif JP"'));
  assert.ok(!css.includes('BlinkMacSystemFont'));
});