import assert from 'node:assert/strict';
import test from 'node:test';

import {
  registerCommunityWatchBeforeProvisioning
} from '../scripts/community-hosted-watchdog-registration.mjs';

const run = {
  repository: 'bingohooah888-ai/novelrise',
  scope: 'community-phase1-hosted-authenticated-write',
  mainSha: 'a'.repeat(40),
  candidateSha: 'b'.repeat(40),
  runId: '456',
  requestCommentId: '123'
};
const grant = {
  ...run,
  status: 'AUTHORIZED_BY_TRUSTED_MAIN_WORKFLOW',
  stagingCostApproved: true,
  runAuthorized: true,
  writeAuthorized: true,
  productionMutationApproved: false,
  protectedEnvironmentVerified: true
};
const claim = {
  ...run,
  status: 'RESERVATION_AND_CLAIM_RECORDED_NO_RUN_AUTHORIZATION',
  claimCommentId: '124'
};
const now = Date.parse('2026-10-22T01:00:00.000Z');
const evidence = {
  status: 'INDEPENDENT_CLEANUP_WATCHDOG_LIVE',
  mainSha: run.mainSha,
  workloadIndependentOfBrowser: true,
  cleanupEnvironmentProtected: true,
  scheduleEnabledVerified: true,
  maxMinutes: 60,
  graceMinutes: 10,
  observedAt: now
};
const signingKey = 'synthetic-signing-key-long-enough-for-test-2026';
const token = 'synthetic-github-and-supabase-token-long-enough';

function harness(existing = []) {
  const calls = [];
  let body = null;
  const fetchImpl = async (url, options) => {
    calls.push(options.method);
    if (url.includes('/projects/')) {
      return { status: 200, json: async () => existing };
    }
    if (url.includes('/comments?per_page=')) {
      return { status: 200, json: async () => [] };
    }
    if (options.method === 'POST') {
      body = JSON.parse(options.body).body;
      return { status: 201, json: async () => ({ id: 444, body }) };
    }
    return { status: 200, json: async () => ({ id: 444, body }) };
  };
  return { calls, fetchImpl };
}
function execute(h, overrides = {}) {
  return registerCommunityWatchBeforeProvisioning({
    run,
    grant,
    claim,
    watchdogEvidence: evidence,
    signingKey,
    githubToken: token,
    supabaseToken: token,
    now,
    fetchImpl: h.fetchImpl,
    ...overrides
  });
}

test('the signed watchdog receipt precedes provisioning', async () => {
  const x = harness();
  const receipt = await execute(x);
  assert.equal(receipt.signatureReadBackVerified, true);
  assert.equal(receipt.providerBranchAbsentAtRegistration, true);
  assert.equal(receipt.mayCreateBranch, false);
  assert.equal(x.calls.filter((item) => item === 'POST').length, 1);
});

test('existing run branch blocks registration', async () => {
  const x = harness([{ name: 'community-hosted-456' }]);
  await assert.rejects(execute(x), /COMMUNITY_WATCH_REGISTRATION_DENIED/u);
  assert.ok(!x.calls.includes('POST'));
});

test('unverified independent watchdog blocks every request', async () => {
  const x = harness();
  await assert.rejects(
    execute(x, {
      watchdogEvidence: { ...evidence, scheduleEnabledVerified: false }
    }),
    /COMMUNITY_WATCH_REGISTRATION_DENIED/u
  );
  assert.deepEqual(x.calls, []);
});
