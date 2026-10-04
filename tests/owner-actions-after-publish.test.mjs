import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const file = 'novelight-episode-number-entry-visibility.js';
const source = readFileSync(file, 'utf8');
const ownershipCheck = 'String(ownership.data.user_id) !== String(userId)';

test('owner controls require verified ownership', () => {
  assert.match(source, /client\.auth\.getUser\(\)/);
  assert.match(source, /select\('id,user_id'\)/);
  assert.ok(source.includes(ownershipCheck));
  assert.match(source, /ownerActions/);
  assert.match(source, /ownerActionsTop/);
  assert.match(source, /backToMyNovels/);
  assert.match(source, /my-novels\.html/);
  assert.match(source, /MutationObserver/);
});
