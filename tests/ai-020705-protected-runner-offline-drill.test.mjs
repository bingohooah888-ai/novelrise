import assert from 'node:assert/strict';
import test from 'node:test';
// prettier-ignore
import { inspect020705ProtectedRunnerOffline } from
  '../.github/staging-ai-02-07-05/protected-runner-offline-drill.mjs';
const NOW = Date.parse('2026-11-01T08:00:00Z');
const SHA = 'a'.repeat(40);
const PREVIEW = 'dpl_synthetic123';
const UID = '11111111-1111-4111-8111-111111111111';
// prettier-ignore
const approved = {
  repository: 'bingohooah888-ai/novelrise',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
  mainSha: SHA, previewDeploymentId: PREVIEW,
  approvalCommentId: 700, runId: 1001,
  actorId: UID, novelId: 41, episodeId: 11,
  provider: 'openai', model: 'gpt-5.6-luna',
  capMicros: 10000000, consentRevision: 'synthetic-test-v1',
  expiresAt: new Date(NOW + 300000).toISOString()
};
// prettier-ignore
function observers() {
  const base = {repository: approved.repository,
    mainSha: SHA, previewDeploymentId: PREVIEW};
  return {
    readMain: async () => ({repository: base.repository,
      branch: 'main', sha: SHA, verifiedReadOnly: true}),
    readRunnerProtection: async () => ({
      ...base, runId: 1001, actor: 'bingohooah888-ai',
      triggeringActor: 'bingohooah888-ai', ref: 'refs/heads/main',
      sha: SHA, environment: 'staging', environmentReviewerApproved: true,
      stagingOnlyCredentials: true, protectedExecution: true
    }),
    readPreview: async () => ({
      id: PREVIEW, projectName: 'novelrise',
      repository: base.repository, gitCommitSha: SHA,
      target: 'preview', state: 'READY', ssoProtected: true,
      stagingSupabaseUrl: 'https://wmlzjgvxgoyrovdhbqbg.supabase.co',
      ownerPreviewApproved: true
    }),
    readMigration: async () => ({
      projectRef: approved.stagingProjectRef,
      supabaseUrl: 'https://wmlzjgvxgoyrovdhbqbg.supabase.co',
      migrationVersion: '20261101060000_novelight_ai_020705_one_shot_claim',
      applied: true, oneShotFunctionPresent: true, serviceRoleOnly: true
    }),
    readSyntheticConsent: async () => ({
      projectRef: approved.stagingProjectRef, actorId: UID,
      novelId: 41, episodeId: 11, chunkIndex: 0,
      verifiedSynthetic: true, explicitOwnerConsent: true,
      consentRevision: approved.consentRevision,
      expiresAt: approved.expiresAt
    }),
    readBillingProtection: async () => ({
      provider: 'openai', model: 'gpt-5.6-luna', currency: 'JPY',
      providerAccountVerified: true, currentOfficialRatesVerified: true,
      exchangeRateVerified: true, singleAttemptNoRetry: true,
      capEnforcedExternally: true, worstCaseTotalMicros: 2000000
    })
  };
}
// prettier-ignore
test('even six matching offline contracts grant NO execution authority', async () => {
  const x = await inspect020705ProtectedRunnerOffline({
    approved, observers: observers(), now: () => NOW
  });
  assert.equal(x.checks.length, 6);
  assert.equal(x.status, 'SIX_OFFLINE_PROOF_CONTRACTS_MATCH');
  assert.equal(x.provenanceAuthenticated, false);
  assert.equal(x.independentWatchdogRunning, false);
  assert.equal(x.externalKillSwitchVerified, false);
  assert.equal(x.authorizesExecution, false);
  assert.equal(x.authorizesPaidCall, false);
  assert.equal(x.authorizesStagingWrite, false);
});
// prettier-ignore
test('one missing or failing proof returns NO-GO and never starts runner', async () => {
  const os = observers();
  os.readPreview = async () => ({id: PREVIEW, state: 'ERROR'});
  const x = await inspect020705ProtectedRunnerOffline({
    approved, observers: os, now: () => NOW
  });
  assert.equal(x.status, 'PROTECTED_RUNNER_PROOFS_INCOMPLETE_NO_GO');
  assert.equal(x.checks.find(z => z.name === 'verifyApprovedPreview').verified, false);
  assert.equal(x.authorizesExecution, false);
});
// prettier-ignore
test('missing required observer / wrong staging project denied before requests', async () => {
  await assert.rejects(inspect020705ProtectedRunnerOffline({
    approved, observers: {}, now: () => NOW
  }), /AI_020705_PROTECTED_RUNNER_DRYRUN_DENIED/u);
  await assert.rejects(inspect020705ProtectedRunnerOffline({
    approved: {...approved, stagingProjectRef: 'fiepaguycecrredwrcwx'},
    observers: observers(), now: () => NOW
  }), /AI_020705_PROTECTED_RUNNER_DRYRUN_DENIED/u);
});
