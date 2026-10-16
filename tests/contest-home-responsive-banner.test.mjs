import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { URL } from 'node:url';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = source('../index.html');
const css = source('../novelight-contest-home-promo.css');
const script = source('../novelight-contest-home-promo.js');

test('approved desktop and mobile contest images replace homepage copy promo', () => {
  assert.match(page, /starfestival-entry-desktop\.webp/);
  assert.match(page, /starfestival-entry-mobile\.webp/);
  assert.match(page, /media="\(max-width: 680px\)"/);
  assert.match(page, /href="contest\.html#enter"/);
  assert.match(page, /id="novelightContestHomePromo"[^>]* hidden>/);
  assert.match(page, /id="novelightContestHomePromoHeading"/);
});

test('home promo preserves picture and hides closed registration', () => {
  assert.doesNotMatch(script, /link\.textContent\s*=/);
  assert.match(script, /data\.contest_status === 'registration'/);
  assert.doesNotMatch(script, /data\.contest_status === 'active'/);
  assert.match(script, /area\.hidden = true/);
  assert.match(css, /\.novelight-contest-home-promo-link picture/);
  assert.match(css, /height:auto/);
});

test('approved binary assets must exist before production merge', () => {
  for (const filename of [
    '../assets/contest/starfestival-entry-desktop.webp',
    '../assets/contest/starfestival-entry-mobile.webp'
  ]) {
    assert.ok(existsSync(new URL(filename, import.meta.url)), filename);
  }
});
