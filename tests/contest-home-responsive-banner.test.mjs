import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = source('../index.html');
const css = source('../novelight-home-promo.css');
const script = source('../novelight-contest-home-promo.js');

test('responsive Star Festival hero uses the approved current artwork and event dates', () => {
  assert.match(page, /id="novelightContestHeroSlide"[^>]* hidden>/);
  assert.match(page, /href="contest\.html#enter"/);
  assert.match(page, /エントリー締切は2026年11月30日23時59分/);
  assert.match(page, /コンテスト開催は12月1日から31日/);
  assert.match(page, /06_starfestival_hero_1600x900\.webp/);
  assert.match(css, /\.home-promo-slide\[hidden\]/);
  assert.match(css, /@media \(max-width: 767px\)/);
});

test('home hero remains registration-only and checks the deadline', () => {
  assert.match(page, /client\.rpc\('novelight_public_contest_catalog'/);
  assert.match(page, /data\.contest_status === 'registration'/);
  assert.match(page, /Date\.now\(\) <= deadline/);
  assert.match(page, /contestSlide\.hidden = false/);
  assert.match(page, /contestSlide\.remove\(\)/);
  assert.doesNotMatch(script, /link\.textContent\s*=/);
  assert.match(script, /data\.contest_status === 'registration'/);
  assert.match(script, /11月30日23:59/);
  assert.match(script, /area\.hidden = true/);
});
