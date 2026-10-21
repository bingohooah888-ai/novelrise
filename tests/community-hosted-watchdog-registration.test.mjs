import assert from 'node:assert/strict';
import test from 'node:test';

import {
  registerCommunityWatchBeforeProvisioning
} from '../scripts/community-hosted-watchdog-registration.mjs';

test('untrusted cleanup registration makes no requests', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    throw new Error('UNEXPECTED_NETWORK_CALL');
  };
  await assert.rejects(
    registerCommunityWatchBeforeProvisioning({ fetchImpl }),
    /COMMUNITY_WATCH_REGISTRATION_DENIED/u
  );
  assert.equal(called, false);
});
