import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const home = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../novelight-home-thumbnails.css', import.meta.url), 'utf8');

test('Home cards hydrate official thumbnail URLs without changing discovery allocation', () => {
  assert.match(home, /client\.from\('novels'\)\.select\('id,thumbnail_url'\)/);
  assert.match(home, /\.eq\('status','published'\)/);
  assert.match(home, /visible=await withOfficialThumbnails\(selected\)/);
  assert.match(home, /hydrated=await withOfficialThumbnails\(rows\)/);
  assert.match(home, /void record\(visible\)/);
});

test('Home cards render official images and retain the existing placeholder fallback', () => {
  assert.match(home, /class=\"novel-cover-image\"/);
  assert.match(home, /class=\"novel-cover-placeholder\"/);
  assert.match(home, /novelight-home-thumbnails\.css/);
  assert.match(css, /aspect-ratio:\s*3 \/ 4/);
  assert.match(css, /object-fit:\s*cover/);
});
