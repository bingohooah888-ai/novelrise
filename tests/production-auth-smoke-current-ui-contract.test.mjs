import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const authenticatedSmoke = await readFile(
  'tests/e2e/production-auth/authenticated-smoke.spec.js',
  'utf8'
);
const authorHomeSmoke = await readFile(
  'tests/e2e/production-auth/author-home-smoke.spec.js',
  'utf8'
);

test('Production Auth Smoke stays aligned with current beta UI contracts', () => {
  assert.match(authenticatedSmoke, /\.thumbnail-option/);
  assert.match(authenticatedSmoke, /input\[name=\"thumbnailAsset\"\]/);
  assert.match(authenticatedSmoke, /record_valid_read_progress/);
  assert.match(
    authenticatedSmoke,
    /\.seed-choice\[data-seed-type=\"BRONZE\"\]/
  );
  assert.match(authenticatedSmoke, /LIGHT SEED送信履歴/);
  assert.match(authenticatedSmoke, /globalThis\.document\.body\.scrollHeight/);
  assert.doesNotMatch(authenticatedSmoke, /(?<!globalThis\.)document\.body/);
  assert.doesNotMatch(authenticatedSmoke, /locator\('#seedButton'\)/);
  assert.doesNotMatch(authenticatedSmoke, /name: 'SCOUT RECORD'/);

  assert.match(authorHomeSmoke, /さんの創作室\$/);
  assert.match(authorHomeSmoke, /page\.locator\('#bio'\)/);
  assert.doesNotMatch(authorHomeSmoke, /profileBioSummary/);
  assert.doesNotMatch(authorHomeSmoke, /作者ホーム\$/);
});
