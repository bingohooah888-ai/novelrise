import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const publicApi = read('api/beta-author-preregistration.js');
const betaHtml = read('beta-authors.html');

test('public preregistration campaign normalizes the legacy release label to September 30', () => {
  assert.match(publicApi, /const LEGACY_RELEASE_LABEL = '2026年9月下旬';/);
  assert.match(publicApi, /const BETA_RELEASE_LABEL = '2026年9月30日';/);
  assert.match(publicApi, /releaseLabel === LEGACY_RELEASE_LABEL/);
  assert.match(publicApi, /return BETA_RELEASE_LABEL;/);
  assert.match(
    publicApi,
    /releaseLabel: publicReleaseLabel\(campaign\.release_label\)/
  );
  assert.doesNotMatch(publicApi, /releaseLabel: campaign\.release_label/);
});

test('explicit admin release labels remain supported while the LP consumes the public API label', () => {
  assert.match(publicApi, /return releaseLabel;/);
  assert.match(betaHtml, /campaign\?\.releaseLabel/);
  assert.doesNotMatch(betaHtml, /2026年9月下旬/);
});
