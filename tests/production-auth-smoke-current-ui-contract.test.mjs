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
const analyticsUi = await readFile('novelight-analytics.js', 'utf8');

test('Production Auth Smoke stays aligned with current beta UI contracts', () => {
  assert.match(authenticatedSmoke, /assertChapter40ComposerReady/);
  assert.match(
    authenticatedSmoke,
    /#thumbnailComposer\.novelight-thumbnail-composer/
  );
  assert.match(authenticatedSmoke, /\.nl-thumb-option\[data-layer-type=/);
  assert.match(
    authenticatedSmoke,
    /canvas\[aria-label="作品サムネイルのプレビュー"\]/
  );
  assert.match(authenticatedSmoke, /waitForThumbnailRenderResult/);
  assert.match(
    authenticatedSmoke,
    /page\.waitForResponse\(async \(candidate\)/
  );
  assert.match(authenticatedSmoke, /body = await candidate\.json\(\)/);
  assert.match(authenticatedSmoke, /'prepare-upload'/);
  assert.match(authenticatedSmoke, /'finalize-upload'/);
  assert.doesNotMatch(authenticatedSmoke, /input\[name=\"thumbnailAsset\"\]/);
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

  assert.match(analyticsUi, /class=\"funnel-node-head\"/);
  assert.match(authenticatedSmoke, /\.funnel-node-head strong/);
  assert.doesNotMatch(authenticatedSmoke, /\.funnel \.step strong/);

  assert.match(authorHomeSmoke, /さんの創作室\$/);
  assert.match(authorHomeSmoke, /page\.locator\('#bio'\)/);
  assert.doesNotMatch(authorHomeSmoke, /profileBioSummary/);
  assert.doesNotMatch(authorHomeSmoke, /作者ホーム\$/);
});
