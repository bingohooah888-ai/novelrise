import assert from 'node:assert/strict';
import test from 'node:test';
// prettier-ignore
import { create020705ReadOnlyStageProofs } from
  '../.github/staging-ai-02-07-05/stage-readonly-proofs.mjs';
// prettier-ignore
import { plan020705IndependentRecovery } from
  '../.github/staging-ai-02-07-05/independent-recovery-plan.mjs';

const NOW = Date.parse('2026-11-01T08:00:00Z');
const SHA = 'a'.repeat(40);
const REF = 'wmlzjgvxgoyrovdhbqbg';
const PREVIEW = 'dpl_synthetic123';
// prettier-ignore
const APPROVED = {
  repository: 'bingohooah888-ai/novelrise',
  stagingProjectRef: REF,
  mainSha: SHA,
  previewDeploymentId: PREVIEW,
  approvalCommentId: 700,
  runId: 1001,
  actorId: '11111111-1111-4111-8111-111111111111',
  novelId: 11,
  episodeId: 12,
  consentRevision: 'test-policy-v1',
  provider: 'openai',
  model: 'gpt-5.6-luna',
  capMicros: 10000000,
  expiresAt: new Date(NOW + 1800000).toISOString()
};
// prettier-ignore
const SCOPE = {
  repository: APPROVED.repository,
  stagingProjectRef: REF,
  mainSha: SHA,
  previewDeploymentId: PREVIEW,
  approvalCommentId: 700,
  runId: 1001,
  novelId: 11,
  episodeId: 12
};

// prettier-ignore
function fixtures() {
  const calls = [];
  const x = {
    readMain: {repository: APPROVED.repository, branch: 'main', sha: SHA, verifiedReadOnly: true},
    readRunnerProtection: {
      repository: APPROVED.repository, runId: 1001, actor: 'bingohooah888-ai',
      triggeringActor: 'bingohooah888-ai', ref: 'refs/heads/main',
      sha: SHA, environment: 'staging', environmentReviewerApproved: true,
      stagingOnlyCredentials: true, protectedExecution: true
    },
    readPreview: {
      id: PREVIEW, projectName: 'novelrise', repository: APPROVED.repository,
      gitCommitSha: SHA, target: 'preview', state: 'READY',
      ssoProtected: true,
      stagingSupabaseUrl: 'https://' + REF + '.supabase.co',
      ownerPreviewApproved: true
    },
    readMigration: {
      projectRef: REF, supabaseUrl: 'https://' + REF + '.supabase.co',
      migrationVersion: '20261101060000_novelight_ai_020705_one_shot_claim',
      applied: true, oneShotFunctionPresent: true, serviceRoleOnly: true
    },
    readSyntheticConsent: {
      projectRef: REF, actorId: APPROVED.actorId, novelId: 11, episodeId: 12,
      chunkIndex: 0, verifiedSynthetic: true, explicitOwnerConsent: true,
      consentRevision: APPROVED.consentRevision, expiresAt: APPROVED.expiresAt
    },
    readBillingProtection: {
      provider: 'openai', model: 'gpt-5.6-luna', currency: 'JPY',
      providerAccountVerified: true, currentOfficialRatesVerified: true,
      exchangeRateVerified: true, singleAttemptNoRetry: true,
      capEnforcedExternally: true, worstCaseTotalMicros: 8000000
    }
  };
  const observers = Object.fromEntries(Object.entries(x).map(([name, value]) => [
    name, async () => { calls.push(name); return value; }
  ]));
  return {x, calls, observers};
}

// prettier-ignore
test('all six offline proof observations match one exact scoped Staging trial', async () => {
  const {observers, calls} = fixtures();
  const p = create020705ReadOnlyStageProofs({
    approved: APPROVED, observers, now: () => NOW
  });
  for (const name of [
    'verifyCurrentMain', 'verifyProtectedRunner', 'verifyApprovedPreview',
    'verifyAtomicMigration', 'verifySyntheticConsent',
    'verifyProviderBillingLimit'
  ]) assert.equal(await p[name](SCOPE), true, name);
  assert.equal(calls.length, 6);
});

// prettier-ignore
test('mismatched scope fails without reading external observations', async () => {
  const {observers, calls} = fixtures();
  const p = create020705ReadOnlyStageProofs({
    approved: APPROVED, observers, now: () => NOW
  });
  assert.equal(await p.verifyCurrentMain({...SCOPE, mainSha: 'b'.repeat(40)}), false);
  assert.equal(calls.length, 0);
});

// prettier-ignore
test('untrusted production preview, unprotected run, migration and price soft cap fail closed', async () => {
  const cases = [
    ['readMain', 'branch', 'other', 'verifyCurrentMain'],
    ['readRunnerProtection', 'environmentReviewerApproved', false, 'verifyProtectedRunner'],
    ['readPreview', 'target', 'production', 'verifyApprovedPreview'],
    ['readPreview', 'ssoProtected', false, 'verifyApprovedPreview'],
    ['readMigration', 'applied', false, 'verifyAtomicMigration'],
    ['readSyntheticConsent', 'explicitOwnerConsent', false, 'verifySyntheticConsent'],
    ['readBillingProtection', 'capEnforcedExternally', false, 'verifyProviderBillingLimit'],
    ['readBillingProtection', 'worstCaseTotalMicros', 10000001, 'verifyProviderBillingLimit']
  ];
  for (const [observer, field, value, proof] of cases) {
    const {x, observers} = fixtures();
    x[observer][field] = value;
    const p = create020705ReadOnlyStageProofs({
      approved: APPROVED, observers, now: () => NOW
    });
    assert.equal(await p[proof](SCOPE), false, observer + '.' + field);
  }
});

// prettier-ignore
test('read-only observer outages and expired approval produce only false', async () => {
  const {observers} = fixtures();
  observers.readMain = async () => { throw new Error('SENSITIVE_LOG_CONTENT'); };
  const p = create020705ReadOnlyStageProofs({
    approved: APPROVED, observers, now: () => NOW
  });
  assert.equal(await p.verifyCurrentMain(SCOPE), false);
  const q = create020705ReadOnlyStageProofs({
    approved: APPROVED, observers, now: () => NOW + 3600000
  });
  assert.equal(await q.verifyAtomicMigration(SCOPE), false);
});

// prettier-ignore
test('missing observer cannot silently be treated as ready', () => {
  const {observers} = fixtures();
  delete observers.readBillingProtection;
  assert.throws(() => create020705ReadOnlyStageProofs({
    approved: APPROVED, observers, now: () => NOW
  }), /AI_020705_PROOF_CONFIG_DENIED/u);
});

// prettier-ignore
const RECOVERY_SCOPE = {
  projectRef: REF, mainSha: SHA,
  previewDeploymentId: PREVIEW, approvalCommentId: 700, runId: 1001
};
// prettier-ignore
function recoveryEvidence(overrides = {}) {
  return {
    ...RECOVERY_SCOPE,
    observedAtMs: NOW,
    claimed: true,
    consumed: false,
    stagingRuntimeOffZero: false,
    syntheticCensusZero: false,
    stagingEnvironmentDisabled: false,
    ...overrides
  };
}

// prettier-ignore
test('orphan CLAIM emits stop/delete/census/CONSUMED plan but NEVER paid retry', () => {
  const plan = plan020705IndependentRecovery({
    scope: RECOVERY_SCOPE, evidence: recoveryEvidence(), now: () => NOW
  });
  assert.equal(plan.status, 'RECOVERY_REQUIRES_SEPARATE_OWNER_APPROVAL');
  assert.equal(plan.noPaidRetry, true);
  assert.deepEqual(plan.actions, [
    'DISABLE_STAGING_AI_AND_ZERO_BUDGET',
    'DISABLE_APPROVED_PREVIEW_ENVIRONMENT',
    'REVOKE_VERIFIED_SYNTHETIC_SESSIONS',
    'DELETE_VERIFIED_SYNTHETIC_FIXTURE',
    'RECHECK_INDEPENDENT_ZERO_CENSUS',
    'APPEND_CONSUMED_TOMBSTONE'
  ]);
});

// prettier-ignore
test('terminal consumed with complete zero census is a true no-op', () => {
  const plan = plan020705IndependentRecovery({
    scope: RECOVERY_SCOPE,
    evidence: recoveryEvidence({
      consumed: true, stagingRuntimeOffZero: true,
      syntheticCensusZero: true, stagingEnvironmentDisabled: true
    }),
    now: () => NOW
  });
  assert.equal(plan.status, 'CONSUMED_AND_CLEANUP_VERIFIED');
  assert.deepEqual(plan.actions, []);
});

// prettier-ignore
test('already CONSUMED but residual data requires cleanup, not another marker', () => {
  const plan = plan020705IndependentRecovery({
    scope: RECOVERY_SCOPE,
    evidence: recoveryEvidence({ consumed: true }),
    now: () => NOW
  });
  assert.equal(plan.actions.includes('APPEND_CONSUMED_TOMBSTONE'), false);
  assert.equal(plan.actions.includes('RECHECK_INDEPENDENT_ZERO_CENSUS'), true);
  assert.equal(plan.noPaidRetry, true);
});

// prettier-ignore
test('unclaimed recovery does not authorize cleanup, paid execution or mutation', () => {
  const plan = plan020705IndependentRecovery({
    scope: RECOVERY_SCOPE,
    evidence: recoveryEvidence({ claimed: false }), now: () => NOW
  });
  assert.equal(plan.status, 'UNCLAIMED_NO_EXECUTION_AUTHORIZED');
  assert.deepEqual(plan.actions, []);
});

// prettier-ignore
test('wrong project, stale evidence and inconsistent ledger are denied', () => {
  for (const changed of [
    {projectRef: 'fiepaguycecrredwrcwx'},
    {observedAtMs: NOW - 400000},
    {claimed: false, consumed: true},
    {approvalCommentId: 701}
  ]) {
    assert.throws(() => plan020705IndependentRecovery({
      scope: RECOVERY_SCOPE,
      evidence: recoveryEvidence(changed), now: () => NOW
    }), /AI_020705_RECOVERY_EVIDENCE_DENIED/u);
  }
});
