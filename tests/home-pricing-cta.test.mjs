import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const home = await readFile('index.html', 'utf8');

test('home pricing cards expose all three plan CTAs', () => {
  assert.match(
    home,
    /<a class="plan-cta" href="signup\.html">無料で始める<\/a>/u
  );
  assert.match(
    home,
    /<a class="plan-cta" href="pricing\.html">Standardを始める<\/a>/u
  );
  assert.match(
    home,
    /<a class="plan-cta" href="pricing\.html">Premiumを始める<\/a>/u
  );
});

test('home pricing CTAs stay bottom-aligned and Standard remains primary', () => {
  assert.match(home, /\.plan\{display:flex;flex-direction:column\}/u);
  assert.match(home, /\.plan-cta\{[^}]*margin-top:auto/u);
  assert.match(
    home,
    /\.plan\.recommended \.plan-cta\{background:var\(--primary\);color:#fff\}/u
  );
});
