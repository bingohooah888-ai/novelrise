import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile('content-guidelines.html', 'utf8');

const MAIN_PRODUCT_TARGETS = [
  'index.html',
  'search.html',
  'pricing.html',
  'ranking.html',
  'login.html',
  'signup.html',
  'author-home.html',
  'reader-home.html',
  'novel.html',
  'novels.html'
];

test('content guidelines header is static and cannot escape to the main product', () => {
  const header =
    html.match(/<header class="site-header"[\s\S]*?<\/header>/)?.[0] || '';

  assert.ok(header, 'site header must exist');
  assert.doesNotMatch(header, /<a\b/i);
  assert.doesNotMatch(header, /<nav\b/i);
});

test('content guidelines contains no direct main-product anchor targets', () => {
  for (const target of MAIN_PRODUCT_TARGETS) {
    assert.doesNotMatch(
      html,
      new RegExp(`href=["']${target.replace('.', '\\.')}`, 'i'),
      `unexpected main-product link: ${target}`
    );
  }
});

test('content guidelines preserves legal and support navigation', () => {
  for (const target of [
    'terms.html',
    'privacy.html',
    'billing-policy.html',
    'commerce-disclosure.html',
    'contact.html'
  ]) {
    assert.match(
      html,
      new RegExp(`href=["']${target.replace('.', '\\.')}`, 'i')
    );
  }
});
