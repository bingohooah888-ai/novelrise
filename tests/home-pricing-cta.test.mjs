import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const home = await readFile('index.html', 'utf8');

test('home pricing cards expose all three beta plan CTAs', () => {
  assert.match(
    home,
    /<a class="plan-cta" href="signup\.html">無料で始める<\/a>/u
  );
  assert.match(
    home,
    /<a class="plan-cta" href="pricing\.html">Standardを無料で利用<\/a>/u
  );
  assert.match(
    home,
    /<a class="plan-cta" href="pricing\.html">Premiumを始める<\/a>/u
  );
  assert.match(home, /β版特別価格/u);
  assert.match(home, /通常 月額¥980/u);
  assert.match(home, /通常 月額¥1,980/u);
  assert.match(home, /<div class="price">¥480 <small>\/ 月<\/small><\/div>/u);
  assert.match(home, /β期間中はカード登録不要/u);
});

test('home pricing CTAs stay bottom-aligned and Standard remains primary', () => {
  assert.match(home, /\.plan\{display:flex;flex-direction:column\}/u);
  assert.match(home, /\.plan-cta\{[^}]*margin-top:auto/u);
  assert.match(
    home,
    /\.plan\.recommended \.plan-cta\{background:var\(--primary\);color:#fff\}/u
  );
});
