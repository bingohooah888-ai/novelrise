import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildHomeThemeBundle } from '../scripts/build-home-theme-bundle.mjs';

test('Home theme bundle matches recursive imports exactly', () => {
  const generated = readFileSync('novelight-home-theme-bundle.css', 'utf8');
  assert.equal(generated, buildHomeThemeBundle());
  assert.doesNotMatch(generated, /^@import /m);
});
