import assert from 'node:assert/strict';
import { readTextSync } from './test-text-utils.mjs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const homeHtml = readTextSync(path.join(repoRoot, 'index.html'), 'utf8');
const promoCss = readTextSync(
  path.join(repoRoot, 'novelight-home-promo.css'),
  'utf8'
);

test('Home hero switches approved desktop/mobile artwork without cropping', () => {
  assert.match(
    homeHtml,
    /<source media="\(max-width: 767px\)" srcset="assets\/home\/02_hero_mobile_900x1600\.png" width="900" height="1600">/u
  );
  assert.match(
    homeHtml,
    /<img class="home-promo-image" src="assets\/home\/01_hero_pc_2560x1280\.png" width="2560" height="1280" alt="NOVELIGHT すべての物語に、光を。"/u
  );
  assert.match(promoCss, /\.home-promo-image \{[\s\S]*?display: block;[\s\S]*?width: 100%;[\s\S]*?height: auto;/u);
  assert.doesNotMatch(promoCss, /object-fit:\s*cover/u);
});
