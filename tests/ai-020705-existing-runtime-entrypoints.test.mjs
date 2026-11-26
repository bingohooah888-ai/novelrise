import assert from 'node:assert/strict';
import test from 'node:test';
import { create020705OwnerStagingLiveEntrypoint } from '../.github/ai-02-07-05-app-composition/owner-staging-live-entrypoint.mjs';
import { create020705ExistingWatchdogEntrypoint } from '../.github/staging-ai-02-07-05/existing-watchdog-entrypoint.mjs';

const MAIN = 'f'.repeat(40);
const CANDIDATE = '05875d4f9c4a60e0caf980c6dcf1c85eb475196b';
const BRANCH = 'staging/ai-02-07-05-live-20261114';
const PREVIEW = 'dpl_HscqVwRoSCxBAt9C3LHLof5971L9';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const REPO = 'bingohooah888-ai/novelrise';
const OWNER = 'bingohooah888-ai';
const context = {
  repository: REPO,
  githubActor: OWNER,
  triggeringActor: OWNER,
  trustedRef: 'refs/heads/main',
  trustedSha: MAIN,
  protectedEnvironment: 'staging',
  projectRef: STAGING,
  supabaseUrl: 'https://' + STAGING + '.supabase.co',
  vercelTarget: 'preview',
  mainSha: MAIN,
  candidateSha: CANDIDATE,
  candidateCheckoutSha: CANDIDATE,
  stagingBranch: BRANCH,
  previewDeploymentId: PREVIEW,
  runId: 17,
  approvalCommentId: 29
};
const expected = {
  mainSha: MAIN,
  candidateSha: CANDIDATE,
  stagingBranch: BRANCH,
  previewDeploymentId: PREVIEW,
  stagingProjectRef: STAGING
};
const scope = {
  repository: REPO,
  stagingProjectRef: STAGING,
  mainSha: MAIN,
  previewDeploymentId: PREVIEW,
  runId: 17,
  approvalCommentId: 29
};

function owner(patch = {}, admission = async () => ({})) {
  return create020705OwnerStagingLiveEntrypoint({
    context: { ...context, ...patch },
    expected,
    readProtectedRunAdmission: admission,
    live: {}
  });
}

function watchdog(patch = {}, read = async () => ({})) {
  return create020705ExistingWatchdogEntrypoint({
    scope: { ...scope, ...patch },
    controllerRunId: 81,
    readControllerCapabilities: read,
    stopOptions: {}
  });
}

test('owner entry rejects PR and Production identity', () => {
  assert.throws(() => owner({ githubActor: 'other' }), /ENTRY_DENIED/);
  assert.throws(() => owner({ trustedRef: 'refs/pull/1' }), /ENTRY_DENIED/);
  assert.throws(
    () => owner({ protectedEnvironment: 'production' }),
    /ENTRY_DENIED/
  );
  assert.throws(
    () => owner({ projectRef: 'fiepaguycecrredwrcwx' }),
    /ENTRY_DENIED/
  );
  assert.throws(() => owner({ candidateSha: 'a'.repeat(40) }), /ENTRY_DENIED/);
});

test('owner entry requires reviewed proof and never retries', async () => {
  let calls = 0;
  const entry = owner({}, async () => {
    calls++;
    return { verifiedReadOnly: false };
  });
  await assert.rejects(entry.run(), /OWNER_LIVE_ENTRY_DENIED/);
  await assert.rejects(entry.run(), /OWNER_LIVE_ENTRY_DENIED/);
  assert.equal(calls, 1);
});

test('watchdog entry rejects Production and self-identity', () => {
  assert.throws(
    () => watchdog({ stagingProjectRef: 'fiepaguycecrredwrcwx' }),
    /ENTRY_DENIED/
  );
  assert.throws(
    () => watchdog({ previewDeploymentId: 'wrong' }),
    /ENTRY_DENIED/
  );
  assert.throws(
    () =>
      create020705ExistingWatchdogEntrypoint({
        scope,
        controllerRunId: scope.runId,
        readControllerCapabilities: async () => ({}),
        stopOptions: {}
      }),
    /ENTRY_DENIED/
  );
});

test('metadata-only Watchdog cannot start cleanup or retry', async () => {
  let calls = 0;
  const entry = watchdog({}, async () => {
    calls++;
    return {
      accountId: '6831b18fe814232fa2dd4c470b95aa15',
      workerName: 'novelight-ai-gatea-watchdog',
      projectRef: STAGING,
      verifiedIndependentSource: false
    };
  });
  await assert.rejects(entry.recover(), /EXISTING_WATCHDOG_ENTRY_DENIED/);
  await assert.rejects(entry.recover(), /EXISTING_WATCHDOG_ENTRY_DENIED/);
  assert.equal(calls, 1);
});
