import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const legacy = readFileSync(
  join(root, 'novelight-legacy-surfaces.css'),
  'utf8'
);
const themeEntry = readFileSync(join(root, 'novelight-theme.css'), 'utf8');

const legacyPages = [
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

test('sitewide theme loads the legacy surface refinement after the base theme', () => {
  const baseIndex = themeEntry.indexOf('novelight-theme-base.css');
  const legacyIndex = themeEntry.indexOf('novelight-legacy-surfaces.css');
  assert.ok(baseIndex >= 0);
  assert.ok(legacyIndex > baseIndex);
});

test('all known legacy creator and reader pages are covered by the refinement layer', () => {
  for (const page of legacyPages) {
    assert.match(
      legacy,
      new RegExp(`\\.novelight-page-${page}(?:[\\s,.:)]|$)`, 'u')
    );
  }
});

test('legacy primary actions use NOVELIGHT navy and gold instead of prototype violet', () => {
  for (const selector of [
    '.submit',
    '.new',
    '.seed-button',
    '.link',
    '.period .active',
    '.modal-actions .send',
  ]) {
    assert.ok(
      legacy.includes(selector),
      `missing legacy control selector: ${selector}`
    );
  }

  assert.match(legacy, /background:\s*var\(--novelight-navy\)/u);
  assert.match(legacy, /border-color:\s*var\(--novelight-gold\)/u);
  assert.doesNotMatch(legacy, /#6d4aff|#8b72ff|#f0edff|#5d45c4/iu);
});

test('dangerous actions retain a distinct danger treatment', () => {
  assert.match(legacy, /\.delete, \.danger/u);
  assert.match(legacy, /color:\s*var\(--novelight-danger\)/u);
});
