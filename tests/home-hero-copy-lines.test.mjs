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

test('Home promo uses the desktop hero artwork in the horizontal carousel', () => {
  assert.match(homeHtml, /class="home-promo-track"/u);
  assert.match(
    homeHtml,
    /<img class="home-promo-image" src="assets\/home\/01_hero_pc_2560x1280\.png" width="2560" height="1280" alt="NOVELIGHT すべての物語に、光を。"/u
  );
  assert.doesNotMatch(homeHtml, /02_hero_mobile_900x1600\.png/u);
  assert.match(promoCss, /scroll-snap-type:\s*x mandatory/u);
  assert.match(
    promoCss,
    /\.home-promo-slide \{[\s\S]*?flex:\s*0 0 100%;[\s\S]*?scroll-snap-align:\s*start;/u
  );
  assert.match(
    promoCss,
    /\.home-promo-image \{[\s\S]*?display: block;[\s\S]*?width: 100%;[\s\S]*?height: auto;/u
  );
  assert.doesNotMatch(promoCss, /object-fit:\s*cover/u);
  assert.match(
    promoCss,
    /@media \(min-width: 768px\)[\s\S]*?\.home-promo-slide > \.home-promo-image,[\s\S]*?\.home-promo-link \{[\s\S]*?width:\s*min\(100%, 1200px\);/u
  );
});
