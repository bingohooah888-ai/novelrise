import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const legacyPath = join(root, 'novelight-legacy-surfaces.css');
const themePath = join(root, 'novelight-theme.css');
const legacy = readFileSync(legacyPath, 'utf8');
const theme = readFileSync(themePath, 'utf8');

const pages = [
  'post',
  'novel-edit',
  'episode-post',
  'episode-edit',
  'my-novels',
  'analytics',
  'scout-record',
  'favorites',
  'author',
  'novel',
  'episode',
];

const primaryControls = [
  '.submit',
  '.new',
  '.seed-button',
  '.link',
  '.period .active',
  '.modal-actions .send',
];

test('legacy layer loads after base theme', () => {
  const baseIndex = theme.indexOf('novelight-theme-base.css');
  const legacyIndex = theme.indexOf('novelight-legacy-surfaces.css');
  assert.ok(baseIndex >= 0);
  assert.ok(legacyIndex > baseIndex);
});

test('legacy pages are covered', () => {
  for (const page of pages) {
    const marker = `.novelight-page-${page}`;
    assert.ok(legacy.includes(marker));
  }
});

test('legacy primary actions use NOVELIGHT colors', () => {
  for (const selector of primaryControls) {
    assert.ok(legacy.includes(selector));
  }
  assert.match(legacy, /background:\s*var\(--novelight-navy\)/u);
  assert.match(legacy, /border-color:\s*var\(--novelight-gold\)/u);
  assert.doesNotMatch(legacy, /#6d4aff|#8b72ff|#f0edff|#5d45c4/iu);
});

test('danger actions keep danger treatment', () => {
  assert.match(legacy, /\.delete, \.danger/u);
  assert.match(legacy, /color:\s*var\(--novelight-danger\)/u);
});
