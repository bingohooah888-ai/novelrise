import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const publicApi = read('api/beta-author-preregistration.js');
const betaHtml = read('beta-authors.html');
const migration = read(
  'supabase/migrations/20260914120000_beta_author_conversion_funnel.sql'
);

test('public preregistration API accepts exactly the funnel event types used by the LP', () => {
  assert.match(
    publicApi,
    /const EVENT_TYPES = new Set\(\[[\s\S]*'page_view'[\s\S]*'cta_click'[\s\S]*'form_start'[\s\S]*'register_click'[\s\S]*\]\)/
  );
  for (const eventType of [
    'page_view',
    'cta_click',
    'form_start',
    'register_click'
  ]) {
    assert.match(betaHtml, new RegExp(`recordEvent\\('${eventType}'\\)`));
    assert.match(migration, new RegExp(eventType));
  }
});

test('final submit no longer inflates the entry CTA metric', () => {
  assert.equal((betaHtml.match(/recordEvent\('cta_click'\)/g) ?? []).length, 1);
  assert.match(betaHtml, /recordEvent\('register_click'\)/);
});
