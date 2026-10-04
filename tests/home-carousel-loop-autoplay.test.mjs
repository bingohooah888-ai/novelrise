import assert from 'node:assert/strict';
import { readTextSync } from './test-text-utils.mjs';
import path from 'node:path';
import test from 'node:test';

// Contract for infinite looping, manual controls, timed autoplay, and linked-slide drag safety.
const repoRoot = path.resolve(import.meta.dirname, '..');
const homeHtml = readTextSync(path.join(repoRoot, 'index.html'), 'utf8');
const promoCss = readTextSync(
  path.join(repoRoot, 'novelight-home-promo.css'),
  'utf8'
);

test('Home promo loops manually and advances automatically', () => {
  assert.match(homeHtml, /data-carousel-prev/u);
  assert.match(homeHtml, /data-carousel-next/u);
  assert.match(homeHtml, /data-carousel-dot/u);
  assert.match(
    homeHtml,
    /const firstClone = originals\[0\]\.cloneNode\(true\);/u
  );
  assert.match(
    homeHtml,
    /const lastClone = originals\.at\(-1\)\.cloneNode\(true\);/u
  );
  assert.match(homeHtml, /track\.insertBefore\(lastClone, originals\[0\]\);/u);
  assert.match(homeHtml, /track\.append\(firstClone\);/u);
  assert.match(homeHtml, /physicalIndex === originals\.length \+ 1/u);
  assert.match(
    homeHtml,
    /window\.setInterval\(\(\) => goTo\(physicalIndex \+ 1\), 6000\)/u
  );
  assert.match(
    homeHtml,
    /if \(reducedMotion\.matches \|\| document\.hidden\) return;/u
  );
  assert.doesNotMatch(homeHtml, /carousel\.matches\(':hover'\)/u);
  assert.doesNotMatch(homeHtml, /mouseenter', stopAutoplay/u);
  assert.doesNotMatch(homeHtml, /focusin', stopAutoplay/u);
  assert.match(homeHtml, /previousButton\.addEventListener\('click'/u);
  assert.match(homeHtml, /nextButton\.addEventListener\('click'/u);
  assert.match(homeHtml, /track\.addEventListener\('pointerdown', event =>/u);
  assert.match(homeHtml, /pointerDragged = false;/u);
  assert.match(homeHtml, /stopAutoplay\(\);/u);
  assert.match(homeHtml, /track\.addEventListener\('pointermove', event =>/u);
  assert.match(homeHtml, /event\.target\.closest\('\.home-promo-link'\)/u);
  assert.match(homeHtml, /event\.preventDefault\(\);/u);
  assert.match(
    homeHtml,
    /track\.addEventListener\('pointerup', startAutoplay/u
  );
  assert.match(homeHtml, /prefers-reduced-motion: reduce/u);
  assert.match(homeHtml, /data-src="assets\/home\/01_hero_pc_2560x1280\.png"/u);
  assert.match(homeHtml, /fetchpriority="low"/u);
  assert.match(homeHtml, /const hydrateSlide = index =>/u);
  assert.match(
    homeHtml,
    /window\.setTimeout\(\(\) => hydrateSlide\(next\), 1800\)/u
  );
  assert.match(homeHtml, /hydrateSlide\(index\);/u);
  assert.match(homeHtml, /warmNextSlide\(index\);/u);
  assert.match(promoCss, /\.home-promo-nav \{/u);
  assert.match(promoCss, /\.home-promo-dots \{/u);
  assert.match(promoCss, /\.home-promo-dot\[aria-current="true"\]/u);
});
