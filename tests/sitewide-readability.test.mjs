import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const theme = read('novelight-theme.css');
const readability = read('novelight-readability.css');
const legal = read('legal.css');
const post = read('post.html');
const authorRoom = read('novelight-author-room.css');

function importedIndex(file) {
  return theme.indexOf(`@import url("${file}");`);
}

function ruleBlock(source, selector) {
  const start = source.indexOf(selector);
  assert.ok(start >= 0, `missing selector: ${selector}`);
  const end = source.indexOf('}', start);
  assert.ok(end > start, `missing rule end: ${selector}`);
  return source.slice(start, end + 1);
}

function expectFontSize(source, selector, size) {
  const block = ruleBlock(source, selector);
  assert.ok(block.includes(`font-size: ${size}`));
}

test('sitewide readability layer loads after typography lock', () => {
  const fontIndex = importedIndex('novelight-font-unification.css');
  const readabilityIndex = importedIndex('novelight-readability.css');

  assert.ok(fontIndex >= 0);
  assert.ok(readabilityIndex > fontIndex);
});

test('creator forms receive the small-text uplift', () => {
  expectFontSize(readability, '.page-title p', '18px !important;');
  expectFontSize(readability, '.required', '13px !important;');
  expectFontSize(readability, '.thumbnail-name', '13px !important;');
  expectFontSize(readability, '.check', '15px !important;');
  expectFontSize(readability, 'input:not([type="checkbox"])', '17px !important;');
});

test('creator utility header matches the Home navigation scale', () => {
  expectFontSize(theme, 'header .right > a {', '22px !important;');
  const responsiveSize = theme.match(/font-size: 20px !important;/gu) || [];
  assert.ok(responsiveSize.length >= 2);
});

test('creator room compact labels are enlarged', () => {
  expectFontSize(readability, '.studio-label', '14px !important;');
  expectFontSize(readability, '.activity-copy time', '13px !important;');
  expectFontSize(readability, '.profile-meta dt', '14px !important;');
  assert.ok(authorRoom.includes('.value{font-size:28px!important}'));
  assert.ok(authorRoom.includes('.section-title h2{font-size:23px!important}'));
});

test('analytics scout reader and auth support text are enlarged', () => {
  expectFontSize(readability, '.label', '14px !important;');
  expectFontSize(readability, '.hero > div:first-child', '13px !important;');
  expectFontSize(readability, '.novel-title, .number', '16px !important;');
  expectFontSize(readability, '.consent', '14px !important;');
});

test('Home and pricing compact supporting text are enlarged', () => {
  expectFontSize(readability, '.novel-title', '15px !important;');
  expectFontSize(readability, '.feature p', '14px !important;');
  expectFontSize(readability, '.pricing-sub', '15px !important;');
});

test('legal pages receive the same readability uplift', () => {
  expectFontSize(legal, '.legal-kicker', '15px;');
  expectFontSize(legal, '.legal-card p', '16px;');
  expectFontSize(legal, '.site-footer-inner', '14px;');
});

test('large creator typography stays unchanged', () => {
  assert.ok(post.includes('.page-title h1{font-size:31px'));
  assert.ok(!readability.includes(' h1'));
  assert.ok(!readability.includes(' h2'));
  assert.ok(!readability.includes('.value {'));
});
