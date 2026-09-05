import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cssPath = path.join(root, 'novelight-home-thumbnails.css');
const css = fs.readFileSync(cssPath, 'utf8');

test('Home hydrates official thumbnails', () => {
  assert.ok(home.includes("select('id,thumbnail_url')"));
  assert.ok(home.includes("eq('status','published')"));
  assert.ok(home.includes('withOfficialThumbnails(selected)'));
  assert.ok(home.includes('withOfficialThumbnails(rows)'));
  assert.ok(home.includes('void record(visible)'));
});

test('Home keeps thumbnail fallback', () => {
  assert.ok(home.includes('class="novel-cover-image"'));
  assert.ok(home.includes('novel-cover-placeholder'));
  assert.ok(home.includes('novelight-home-thumbnails.css'));
  assert.ok(css.includes('aspect-ratio: 3 / 4'));
  assert.ok(css.includes('object-fit: cover'));
});
