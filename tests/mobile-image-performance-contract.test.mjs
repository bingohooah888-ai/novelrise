import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const homeHero = readFileSync(join(root, 'novelight-home-hero.css'), 'utf8');
const featureCss = readFileSync(join(root, 'novelight-home-feature-icons.css'), 'utf8');
const authorCss = readFileSync(join(root, 'novelight-author-room.css'), 'utf8');
const betaAuthors = readFileSync(join(root, 'beta-authors.html'), 'utf8');
const thumbnailRuntime = readFileSync(join(root, 'novelight-thumbnail-runtime.js'), 'utf8');

const budgets = new Map([
  ['assets/novelight-feature-discovery.webp', 50_000],
  ['assets/novelight-feature-light-seed.webp', 50_000],
  ['assets/novelight-feature-analytics.webp', 50_000],
  ['assets/author-room/action-post.webp', 40_000],
  ['assets/author-room/action-works.webp', 40_000],
  ['assets/author-room/action-seed.webp', 40_000],
  ['assets/author-room/action-plan.webp', 40_000],
  ['assets/author-room/metric-works.webp', 40_000],
  ['assets/author-room/metric-episodes.webp', 40_000],
  ['assets/author-room/metric-readers.webp', 40_000],
  ['assets/author-room/metric-favorites.webp', 40_000],
  ['assets/author-room/metric-comments.webp', 40_000],
  ['assets/NOVELIGHT_PC_HERO_FINAL_2560x1280.webp', 600_000],
  ['assets/NOVELIGHT_MOBILE_HERO_FINAL_900x1600.webp', 350_000],
  ['assets/NOVELIGHT_NOCTURNE_FINAL_800x1000.webp', 260_000],
  ['assets/novelight-beta-brand.webp', 200_000],
  ['assets/founding-authors-badge-2026.webp', 120_000],
  ['assets/NOVELIGHT_LP_BELOW_HERO_PC_2560x1800.webp', 650_000]
]);

test('optimized mobile-facing assets exist within transfer budgets', () => {
  for (const [relativePath, maxBytes] of budgets) {
    const absolutePath = join(root, relativePath);
    assert.equal(existsSync(absolutePath), true, `${relativePath} is missing`);
    assert.ok(
      statSync(absolutePath).size <= maxBytes,
      `${relativePath} exceeds ${maxBytes} bytes`
    );
  }
});

test('home visual surfaces use optimized WebP assets without the legacy hero PNG layer', () => {
  assert.doesNotMatch(homeHero, /novelight-home-hero\.png/u);
  assert.match(homeHero, /novelight-home-hero\.webp/u);
  assert.doesNotMatch(featureCss, /novelight-feature-(?:discovery|light-seed|analytics)\.png/u);
  assert.match(featureCss, /novelight-feature-discovery\.webp/u);
  assert.match(featureCss, /novelight-feature-light-seed\.webp/u);
  assert.match(featureCss, /novelight-feature-analytics\.webp/u);
});

test('author studio uses compact WebP action and metric artwork', () => {
  assert.doesNotMatch(authorCss, /ChatGPT Image 2026年9月7日 01_37_/u);
  for (const name of [
    'action-post.webp',
    'action-works.webp',
    'action-seed.webp',
    'action-plan.webp',
    'metric-works.webp',
    'metric-episodes.webp',
    'metric-readers.webp',
    'metric-favorites.webp',
    'metric-comments.webp'
  ]) {
    assert.match(authorCss, new RegExp(name.replace('.', '\\.'), 'u'));
  }
});

test('beta author landing page uses optimized hero, mascot, brand, badge and desktop background assets', () => {
  assert.match(betaAuthors, /NOVELIGHT_PC_HERO_FINAL_2560x1280\.webp/u);
  assert.match(betaAuthors, /NOVELIGHT_MOBILE_HERO_FINAL_900x1600\.webp/u);
  assert.match(betaAuthors, /NOVELIGHT_NOCTURNE_FINAL_800x1000\.webp/u);
  assert.match(betaAuthors, /NOVELIGHT_LP_BELOW_HERO_PC_2560x1800\.webp/u);
  assert.match(betaAuthors, /novelight-beta-brand\.webp/u);
  assert.match(betaAuthors, /founding-authors-badge-2026\.webp/u);
  assert.match(betaAuthors, /founding-badge-image[^>]+loading="lazy"[^>]+decoding="async"/u);
});

test('reader thumbnail runtime never composites 1086x1448 geometry in the browser', () => {
  assert.doesNotMatch(thumbnailRuntime, /createElement\(['"]canvas['"]\)/u);
  assert.doesNotMatch(thumbnailRuntime, /new Image\(\)/u);
  assert.doesNotMatch(thumbnailRuntime, /toDataURL/u);
  assert.doesNotMatch(thumbnailRuntime, /novelight-thumbnail-composer\.js/u);
  assert.match(thumbnailRuntime, /composition\?\.render_url/u);
  assert.match(thumbnailRuntime, /applyCachedThumbnail/u);
});
