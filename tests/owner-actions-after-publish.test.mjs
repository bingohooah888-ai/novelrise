import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  'novelight-episode-number-entry-visibility.js',
  'utf8',
);

test('novel detail restores owner controls only after authenticated ownership verification', () => {
  assert.match(source, /client\.auth\.getUser\(\)/);
  assert.match(source, /select\('id,user_id'\)/);
  assert.match(source, /String\(ownership\.data\.user_id\) !== String\(userId\)/);
  assert.match(source, /ownerActions/);
  assert.match(source, /ownerActionsTop/);
  assert.match(source, /backToMyNovels/);
  assert.match(source, /my-novels\.html/);
  assert.match(source, /MutationObserver/);
});
