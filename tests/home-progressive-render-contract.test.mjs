import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const home = readFileSync('index.html', 'utf8');
const promo = readFileSync('novelight-home-promo.css', 'utf8');
const community = readFileSync('novelight-community.js', 'utf8');

test('contest availability stays authoritative', () => {
  assert.match(home, /id="novelightContestHeroSlide"[^>]*hidden>/);
  assert.match(home, /novelight_public_contest_catalog/);
  assert.match(home, /data\.contest_status === 'registration'/);
  assert.match(home, /contestSlide\.hidden = false/);
  assert.match(home, /contestSlide\.remove\(\)/);
  assert.match(home, /\.home-promo-carousel\[data-initializing\]/);
  assert.match(promo, /min-height:\s*min\(56\.25vw,\s*675px\)/);
});

test('original campaign images stay available', () => {
  assert.match(home, /_vercel\/image\?url=/);
  assert.match(home, /\[640, 1080, 1600\]/);
  assert.match(home, /image\.removeAttribute\('srcset'\)/);
  assert.match(home, /image\.src = source/);
  assert.match(home, /05_campaign_official_after_announcement_1600x900\.png/);
  assert.match(home, /03_author_features_1600x900\.png/);
  assert.match(home, /04_reader_promo_1600x900\.png/);
});

test('below fold calls keep back and forward restoration', () => {
  assert.match(home, /function deferHomeSecondaryShelves\(\)/);
  assert.match(home, /IntersectionObserver/);
  assert.match(home, /type === 'back_forward'/);
  assert.match(home, /loadSeedShelf\(\),loadRankDiscoveryShelves\(\)/);
  assert.match(home, /novelight:page-content-ready/);
  assert.match(community, /function startFeed\(\)/);
  assert.match(community, /isHome && !returningHome/);
  assert.match(community, /observer\.observe\(panel\)/);
  assert.match(community, /novelight_community_feed/);
});

test('home omits bookshelf code and preserves account tools', () => {
  assert.doesNotMatch(home, /<script src="novelight-bookshelf\.js"><\/script>/);
  assert.match(home, /<script src="novelight-reader-account\.js"><\/script>/);
  assert.match(home, /<script src="novelight-today-book\.js"><\/script>/);
  assert.match(home, /record_trusted_allocation_receipts_v2/);
});

test('home prefetches festival gate before app scripts', () => {
  const early = home.indexOf('novelightContestGatePrefetch = fetch(');
  const css = home.indexOf('href="novelight-theme.css"');
  const sdk = home.indexOf('src="/assets/vendor/supabase-js-2.112.3.js"');
  assert.ok(early >= 0 && early < css && css < sdk);
  assert.match(home, /earlyGate \|\| await client\.rpc/);
  assert.match(home, /cache: 'no-store'/);
  assert.match(home, /response\.ok \?/);
  assert.match(home, /data\.contest_status === 'registration'/);
  assert.match(home, /Date\.now\(\) <= deadline/);
});
