import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('novelight-series.js', 'utf8');

test('series runtime independently restores verified owner actions', () => {
  assert.match(source, /client\.auth\.getUser\(\)/);
  assert.match(source, /select\('id,user_id'\)/);
  assert.match(
    source,
    /String\(ownership\.data\.user_id\) !== String\(userId\)/
  );
  assert.match(source, /ownerActions/);
  assert.match(source, /ownerActionsTop/);
  assert.match(source, /backToMyNovels/);
  assert.match(source, /verifiedOwnerVisibilityGuard/);
  assert.match(source, /MutationObserver/);
});

test('entry-number runtime is cache-busted after owner recovery hotfix', () => {
  assert.match(
    source,
    /novelight-episode-number-entry-visibility\.js\?v=20261004-owner-actions-v3/
  );
});
