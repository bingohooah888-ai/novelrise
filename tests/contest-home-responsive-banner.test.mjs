import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = source('../index.html');
const css = source('../novelight-contest-home-promo.css');
const script = source('../novelight-contest-home-promo.js');

test('responsive star festival banner uses live updated copy rather than stale dated WebP', () => {
  assert.match(page, /id="novelightContestHomePromo"[^>]* hidden>/);
  assert.match(page, /href="contest\.html#enter"/);
  assert.match(page, /2026年11月30日（月）23:59/);
  assert.match(page, /12月1日（火）〜31日（木）/);
  assert.doesNotMatch(page, /starfestival-entry-(desktop|mobile)\.webp/);
  assert.match(css, /\.starfestival-banner-title/);
  assert.match(css, /@media\(max-width:680px\)/);
});

test('home promo remains registration-only and checks the deadline', () => {
  assert.doesNotMatch(script, /link\.textContent\s*=/);
  assert.match(script, /data\.contest_status === 'registration'/);
  assert.match(script, /11月30日23:59/);
  assert.match(script, /area\.hidden = true/);
});
