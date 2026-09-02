import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [pricing, home, refinement] = await Promise.all([
  readFile(new URL('../pricing.html', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../novelight-brand-refinement.css', import.meta.url), 'utf8'),
]);

test('public pages load the shared NOVELIGHT brand refinement', () => {
  assert.match(pricing, /novelight-brand-refinement\.css/);
  assert.match(home, /novelight-brand-refinement\.css/);
  assert.match(pricing, /assets\/novelight-header-logo\.webp/);
  assert.match(home, /assets\/novelight-header-logo\.webp/);
});

test('pricing emblems use semantic plan-specific CSS medallions', () => {
  assert.match(pricing, /plan-emblem free-emblem/);
  assert.match(pricing, /plan-emblem standard-emblem/);
  assert.match(pricing, /plan-emblem premium-emblem/);
  assert.match(refinement, /\.free-emblem/);
  assert.match(refinement, /\.standard-emblem/);
  assert.match(refinement, /\.premium-emblem/);
});

test('pricing refinement removes strike-through pricing and raises legibility', () => {
  assert.match(refinement, /\.original-price[\s\S]*text-decoration:\s*none/);
  assert.match(refinement, /\.site-nav a[\s\S]*font-size:\s*16px/);
  assert.match(refinement, /\.price\s*\{[\s\S]*font-size:\s*50px/);
  assert.match(refinement, /--brand-display-font/);
});

test('billing actions remain wired to the existing safe endpoints', () => {
  assert.match(pricing, /\/api\/activate-beta-standard/);
  assert.match(pricing, /\/api\/create-checkout-session/);
  assert.match(pricing, /login\.html\?redirect=pricing\.html/);
});
