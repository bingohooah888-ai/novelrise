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
const watchdogEvidence = {
  status: 'INDEPENDENT_CLEANUP_WATCHDOG_LIVE',
  mainSha: run.mainSha,
  workloadIndependentOfBrowser: true,
  cleanupEnvironmentProtected: true,
  scheduleEnabledVerified: true,
  maxMinutes: 60,
  graceMinutes: 10,
  observedAt: now
};
const secret = 'synthetic-signing-key-long-enough-for-test-2026';
const token = 'synthetic-github-and-supabase-token-long-enough';

function fixture(existing = []) {
  const calls = [];
  let signed;
  const fetchImpl = async (url, init) => {
    calls.push(init.method + ' ' + url);
    if (url.includes('/projects/')) {
      return { status: 200, json: async () => existing };
    }
    if (url.includes('/comments?per_page=')) {
      return { status: 200, json: async () => [] };
    }
    if (init.method === 'POST') {
      signed = JSON.parse(init.body).body;
      return { status: 201, json: async () => ({
        id: 444, body: signed
      }) };
    }
    return { status: 200, json: async () => ({ id: 444, body: signed }) };
  };
  return { calls, fetchImpl };
}
function execute(x, changes = {}) {
  return registerCommunityWatchBeforeProvisioning({
    run,
    grant,
    claim,
    watchdogEvidence,
    signingKey: secret,
    githubToken: token,
    supabaseToken: token,
    now,
    fetchImpl: x.fetchImpl,
    ...changes
  });
}
test('signed registration precedes provisioning and is read back', async () => {
  const x = fixture();
  const proof = await execute(x);
  assert.equal(proof.status, 'CLEANUP_WATCH_REGISTERED_NO_PROVISION');
  assert.equal(proof.signatureReadBackVerified, true);
  assert.equal(proof.mayCreateBranch, false);
  assert.equal(x.calls.filter((c) => c.startsWith('POST')).length, 1);
});
test('existing run branch prevents any registration', async () => {
  const x = fixture([{ name: 'community-hosted-456' }]);
  await assert.rejects(execute(x), /COMMUNITY_WATCH_REGISTRATION_DENIED/u);
  assert.equal(x.calls.filter((c) => c.startsWith('POST')).length, 0);
});
test('missing trusted watchdog proof blocks before any request', async () => {
  const x = fixture();
  await assert.rejects(execute(x, {
    watchdogEvidence: {
      ...watchdogEvidence,
      scheduleEnabledVerified: false
    }
  }), /COMMUNITY_WATCH_REGISTRATION_DENIED/u);
  assert.deepEqual(x.calls, []);
});
test('expired watchdog observation fails closed', async () => {
  const x = fixture();
  await assert.rejects(execute(x, {
    watchdogEvidence: { ...watchdogEvidence, observedAt: now - 360000 }
  }), /COMMUNITY_WATCH_REGISTRATION_DENIED/u);
  assert.deepEqual(x.calls, []);
});
