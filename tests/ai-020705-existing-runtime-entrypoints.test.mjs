import assert from 'node:assert/strict';
import test from 'node:test';
import { create020705OwnerStagingLiveEntrypoint } from
  '../.github/ai-02-07-05-app-composition/owner-staging-live-entrypoint.mjs';
import { create020705ExistingWatchdogEntrypoint } from
  '../.github/staging-ai-02-07-05/existing-watchdog-entrypoint.mjs';

const MAIN = 'f33830558dd357e14bfacace349c7a77baaf8661';
const CANDIDATE = '05875d4f9c4a60e0caf980c6dcf1c85eb475196b';
const BRANCH = 'staging/ai-02-07-05-live-20261114';
const PREVIEW = 'dpl_HscqVwRoSCxBAt9C3LHLof5971L9';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const REPO = 'bingohooah888-ai/novelrise';
const OWNER = 'bingohooah888-ai';
const context = Object.freeze({
  repository: REPO, githubActor: OWNER, triggeringActor: OWNER,
  trustedRef: 'refs/heads/main', trustedSha: MAIN,
  protectedEnvironment: 'staging', projectRef: STAGING,
  supabaseUrl: 'https://' + STAGING + '.supabase.co',
  vercelTarget: 'preview', mainSha: MAIN, candidateSha: CANDIDATE,
  candidateCheckoutSha: CANDIDATE, stagingBranch: BRANCH,
  previewDeploymentId: PREVIEW, runId: 17, approvalCommentId: 29
});
const expected = Object.freeze({
  mainSha: MAIN, candidateSha: CANDIDATE, stagingBranch: BRANCH,
  previewDeploymentId: PREVIEW, stagingProjectRef: STAGING
});
const proof = Object.freeze({
  verifiedReadOnly: true, repository: REPO, runId: 17,
  ref: 'refs/heads/main', sha: MAIN, actor: OWNER, triggeringActor: OWNER,
  environment: 'staging', environmentReviewerApproved: true,
  candidateCheckoutSha: CANDIDATE, stagingBranch: BRANCH,
  previewDeploymentId: PREVIEW
});
const watchdogScope = Object.freeze({
  repository: REPO, stagingProjectRef: STAGING, mainSha: MAIN,
  previewDeploymentId: PREVIEW, runId: 17, approvalCommentId: 29
});
const observed = Object.freeze({
  verifiedIndependentSource: true,
  accountId: '6831b18fe814232fa2dd4c470b95aa15',
  workerName: 'novelight-ai-gatea-watchdog',
  namespaceId: '015ef5be967f4fbfbad31ab24a22bf26',
  projectRef: STAGING, runId: 17, controllerRunId: 81,
  separateFromRunner: true, signedDeathProofAvailable: true,
  atomicRecoveryClaimAvailable: true, stagingStopAuthorityVerified: true,
  syntheticRevocationVerified: true, independentCensusVerified: true
});

test('owner entry rejects PR / Production and lacks any implicit authority', () => {
  let checked = 0;
  const readProtectedRunAdmission = async () => { checked++; return proof; };
  for (const patch of [
    { trustedRef: 'refs/pull/2860/merge' },
    { protectedEnvironment: 'production' },
    { candidateCheckoutSha: 'a'.repeat(40) },
    { githubActor: 'other-actor' },
    { projectRef: 'fiepaguycecrredwrcwx' }
  ]) {
    assert.throws(() => create020705OwnerStagingLiveEntrypoint({
      context: { ...context, ...patch }, expected,
      readProtectedRunAdmission, live: {}
    }), /OWNER_LIVE_ENTRY_DENIED/);
  }
  assert.equal(checked, 0);
});

test('owner entry fails closed on unsigned/unreviewed observation and is one-shot', async () => {
  let checked = 0;
  const entry = create020705OwnerStagingLiveEntrypoint({
    context, expected, live: {},
    readProtectedRunAdmission: async () => { checked++; return { ...proof, environmentReviewerApproved: false }; }
  });
  await assert.rejects(() => entry.run(), /OWNER_LIVE_ENTRY_DENIED/);
  await assert.rejects(() => entry.run(), /OWNER_LIVE_ENTRY_DENIED/);
  assert.equal(checked, 1);
});

test('owner entry does not bypass existing composition even after scope admission', async () => {
  const entry = create020705OwnerStagingLiveEntrypoint({
    context, expected, readProtectedRunAdmission: async () => proof, live: {}
  });
  await assert.rejects(() => entry.run(), /LIVE_COMPOSITION_DENIED/);
});

test('watchdog entry forbids same-process identity and Production scope', () => {
  const readControllerCapabilities = async () => observed;
  for (const [scope, controllerRunId] of [
    [watchdogScope, 17],
    [{ ...watchdogScope, stagingProjectRef: 'fiepaguycecrredwrcwx' }, 81],
    [{ ...watchdogScope, previewDeploymentId: 'invalid' }, 81]
  ]) {
    assert.throws(() => create020705ExistingWatchdogEntrypoint({
      scope, controllerRunId, readControllerCapabilities, stopOptions: {}
    }), /EXISTING_WATCHDOG_ENTRY_DENIED/);
  }
});

test('watchdog status metadata alone cannot start recovery or cleanup', async () => {
  let reads = 0;
  const watchdog = create020705ExistingWatchdogEntrypoint({
    scope: watchdogScope, controllerRunId: 81,
    readControllerCapabilities: async () => {
      reads++;
      return { ...observed, stagingStopAuthorityVerified: 'NOT_VERIFIED' };
    }, stopOptions: {}
  });
  await assert.rejects(() => watchdog.recover(), /EXISTING_WATCHDOG_ENTRY_DENIED/);
  await assert.rejects(() => watchdog.recover(), /EXISTING_WATCHDOG_ENTRY_DENIED/);
  assert.equal(reads, 1);
});

test('verified metadata never replaces existing signed-death and stop adapter', async () => {
  const watchdog = create020705ExistingWatchdogEntrypoint({
    scope: watchdogScope, controllerRunId: 81,
    readControllerCapabilities: async () => observed,
    stopOptions: {}
  });
  await assert.rejects(() => watchdog.recover(), /DETACHED_STOP_DENIED/);
});
