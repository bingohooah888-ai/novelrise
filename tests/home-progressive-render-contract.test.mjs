import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const home = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const promo = readFileSync(new URL('../novelight-home-promo.css', import.meta.url), 'utf8');
const community = readFileSync(new URL('../novelight-community.js', import.meta.url), 'utf8');

test('home contest is hidden until the authoritative registration gate resolves', () => {
  assert.match(home, /id="novelightContestHeroSlide"[^>]*hidden>/);
  assert.match(home, /novelight_public_contest_catalog/);
  assert.match(home, /data\.contest_status === 'registration'/);
  assert.match(home, /contestSlide\.hidden = false/);
  assert.match(home, /contestSlide\.remove\(\)/);
  assert.match(home, /data-initializing/);
  assert.match(promo, /\.home-promo-carousel\[data-initializing\]/);
  assert.match(promo, /min-height:\s*min\(56\.25vw,\s*675px\)/);
});

test('approved promo imagery retains exact source fallback and gains responsive optimization', () => {
  assert.match(home, /_vercel\/image\?url=/);
  assert.match(home, /\[640, 1080, 1600\]/);
  assert.match(home, /image\.removeAttribute\('srcset'\)/);
  assert.match(home, /image\.src = source/);
  for (const art of [
    '05_campaign_official_after_announcement_1600x900.png',
    '03_author_features_1600x900.png',
    '04_reader_promo_1600x900.png'
  ]) {
    assert.ok(home.includes(art), 'Missing approved image ' + art);
  }
});

test('secondary discovery and community requests are deferred off screen with restoration fallback', () => {
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

test('homepage skips library for other pages while preserving visible reader features', () => {
  assert.doesNotMatch(home, /<script src="novelight-bookshelf\.js"><\/script>/);
  assert.match(home, /<script src="novelight-reader-account\.js"><\/script>/);
  assert.match(home, /<script src="novelight-today-book\.js"><\/script>/);
  assert.match(home, /record_trusted_allocation_receipts_v2/);
});
