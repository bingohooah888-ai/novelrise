import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const homeHeroCss = readFileSync(join(root, 'novelight-home-hero.css'), 'utf8');
const homeCardsCss = readFileSync(join(root, 'novelight-home-cards.css'), 'utf8');

test('Home story cards expose only artwork, title, author, and genre', () => {
  assert.match(homeHeroCss, /^@import url\("novelight-home-cards\.css"\);/u);
  assert.match(homeCardsCss, /\.shelf-card \.meta,[\s\S]*?display:\s*none;/u);
  assert.match(homeCardsCss, /\.shelf-card \.seed-count[\s\S]*?display:\s*none;/u);
  assert.match(homeCardsCss, /\.shelf-card \.cover-genre[\s\S]*?display:\s*none;/u);
  assert.match(homeCardsCss, /\.shelf-card \.novel-title[\s\S]*?order:\s*1;/u);
  assert.match(homeCardsCss, /\.shelf-card \.novel-author[\s\S]*?order:\s*2;/u);
  assert.match(homeCardsCss, /\.shelf-card \.genre[\s\S]*?order:\s*3;/u);
});
