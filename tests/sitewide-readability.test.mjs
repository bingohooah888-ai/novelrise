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

test('sitewide readability layer loads after typography lock', () => {
  const fontIndex = importedIndex('novelight-font-unification.css');
  const readabilityIndex = importedIndex('novelight-readability.css');

  assert.ok(fontIndex >= 0, 'font unification import exists');
  assert.ok(readabilityIndex > fontIndex, 'readability loads after font lock');
});

test('creator form small text receives the two-pixel uplift', () => {
  assert.ok(readability.includes('font-size: 18px !important;'));
  assert.match(readability, /\) :is\(label, \.legend\) \{[\s\S]*?font-size: 16px !important;/u);
  assert.match(readability, /\.required \{[\s\S]*?font-size: 13px !important;/u);
  assert.match(
    readability,
    /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\), select, textarea\)[\s\S]*?font-size: 17px !important;/u
  );
  assert.match(readability, /\.check \{[\s\S]*?font-size: 15px !important;/u);
});

test('creator utility header matches the Home navigation scale', () => {
  assert.match(
    theme,
    /header \.right > a \{\s*font-size: 22px !important;/u
  );
  assert.match(
    theme,
    /@media \(min-width: 641px\) and \(max-width: 1180px\)[\s\S]*?header \.right > a \{\s*font-size: 20px !important;/u
  );
  assert.match(
    theme,
    /@media \(max-width: 640px\)[\s\S]*?header \.right > a \{\s*font-size: 20px !important;/u
  );
});

test('creator room compact labels are enlarged without changing large values', () => {
  assert.match(readability, /\.studio-label \{\s*font-size: 14px !important;/u);
  assert.match(
    readability,
    /\.activity-copy time,[\s\S]*?\.avatar-note \{\s*font-size: 13px !important;/u
  );
  assert.ok(authorRoom.includes('.value{font-size:28px!important}'));
  assert.ok(authorRoom.includes('.section-title h2{font-size:23px!important}'));
});

test('reader cards analytics and auth support text are enlarged', () => {
  assert.match(
    readability,
    /novelight-page-analytics \.label \{\s*font-size: 14px !important;/u
  );
  assert.match(
    readability,
    /novelight-page-scout-record :is\(\.note, \.meta\) \{\s*font-size: 14px !important;/u
  );
  assert.match(
    readability,
    /novelight-page-episode :is\(\.novel-title, \.number\) \{\s*font-size: 16px !important;/u
  );
  assert.match(readability, /\.consent \{\s*font-size: 14px !important;/u);
});

test('Home and pricing only lift compact supporting typography', () => {
  assert.match(
    readability,
    /novelight-page-index\.novelight-public-dark \.novel-title \{\s*font-size: 15px !important;/u
  );
  assert.match(
    readability,
    /novelight-page-index\.novelight-public-dark \.feature p \{\s*font-size: 14px !important;/u
  );
  assert.match(
    readability,
    /novelight-page-pricing\.novelight-public-dark \.pricing-sub \{\s*font-size: 15px !important;/u
  );
});

test('legal pages receive the same readability uplift', () => {
  assert.match(legal, /\.legal-kicker \{[\s\S]*?font-size: 15px;/u);
  assert.match(
    legal,
    /\.legal-card p,[\s\S]*?\.legal-table \{\s*font-size: 16px;/u
  );
  assert.match(legal, /\.site-footer-inner \{[\s\S]*?font-size: 14px;/u);
});

test('large creator form heading stays unchanged', () => {
  assert.ok(post.includes('.page-title h1{font-size:31px'));
  assert.doesNotMatch(readability, /\bh1\b|\bh2\b|\.value\s*\{/u);
});
