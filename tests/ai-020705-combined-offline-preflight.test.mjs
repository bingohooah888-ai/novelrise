import assert from 'node:assert/strict';
import test from 'node:test';
import { inspect020705CombinedGateABCOffline } from '../.github/staging-ai-02-07-05/protected-runner-offline-drill.mjs';

const NOW = Date.parse('2026-11-01T08:00:00Z');
const SHA = 'a'.repeat(40);
const PREVIEW = 'dpl_synthetic123';
const UID = '11111111-1111-4111-8111-111111111111';
const REPO = 'bingohooah888-ai/novelrise';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const BRANCH = 'staging/ai-02-07-05-gatebc-20261105';
const required = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'NOVELIGHT_STAGING_SUPABASE_URL',
  'NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY',
  'NOVELIGHT_AI_ENABLED',
  'NOVELIGHT_AI_REVIEW_ENABLED',
  'NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED',
  'NOVELIGHT_AI_020705_ONE_SHOT_ENABLED'
];
const approved = {
  repository: REPO,
  stagingProjectRef: STAGING,
  mainSha: SHA,
  previewDeploymentId: PREVIEW,
  approvalCommentId: 700,
  runId: 1001,
  actorId: UID,
  novelId: 41,
  episodeId: 11,
  provider: 'openai',
  model: 'gpt-5.6-luna',
  capMicros: 10000000,
  consentRevision: 'synthetic-test-v1',
  expiresAt: new Date(NOW + 300000).toISOString()
};

function observers() {
  return {
    readMain: async () => ({
      repository: REPO,
      branch: 'main',
      sha: SHA,
      verifiedReadOnly: true
    }),
    readRunnerProtection: async () => ({
      repository: REPO,
      runId: 1001,
      actor: 'bingohooah888-ai',
      triggeringActor: 'bingohooah888-ai',
      ref: 'refs/heads/main',
      sha: SHA,
      environment: 'staging',
      environmentReviewerApproved: true,
      stagingOnlyCredentials: true,
      protectedExecution: true
    }),
    readPreview: async () => ({
      id: PREVIEW,
      projectName: 'novelrise',
      repository: REPO,
      gitCommitSha: SHA,
      target: 'preview',
      state: 'READY',
      ssoProtected: true,
      stagingSupabaseUrl: 'https://' + STAGING + '.supabase.co',
      ownerPreviewApproved: true
    }),
    readMigration: async () => ({
      projectRef: STAGING,
      supabaseUrl: 'https://' + STAGING + '.supabase.co',
      migrationVersion: '20261101060000_novelight_ai_020705_one_shot_claim',
      applied: true,
      oneShotFunctionPresent: true,
      serviceRoleOnly: true
    }),
    readSyntheticConsent: async () => ({
      projectRef: STAGING,
      actorId: UID,
      novelId: 41,
      episodeId: 11,
      chunkIndex: 0,
      verifiedSynthetic: true,
      explicitOwnerConsent: true,
      consentRevision: approved.consentRevision,
      expiresAt: approved.expiresAt
    }),
    readBillingProtection: async () => ({
      provider: 'openai',
      model: approved.model,
      currency: 'JPY',
      providerAccountVerified: true,
      currentOfficialRatesVerified: true,
      exchangeRateVerified: true,
      singleAttemptNoRetry: true,
      capEnforcedExternally: true,
      worstCaseTotalMicros: 2000000
    })
  };
}

function inputs() {
  const envMetadata = required.map((key) => ({
    key,
    target: ['preview'],
    gitBranch: BRANCH
  }));
  const supervisorScope = {
    ...approved,
    issueNumber: 294
  };
  let offlineReads = 0;
  const supervisor = {
    scope: supervisorScope,
    readOwnerLedger: async () => {
      offlineReads += 1;
      return {};
    },
    readGithubRunner: async () => {
      offlineReads += 1;
      return {
        repository: REPO,
        runId: 1001,
        mainSha: SHA,
        workflowPath:
          '.github/workflows/ai-020705-owner-staging-paid-trial.yml',
        runAttempt: 1,
        jobCount: 1,
        status: 'in_progress',
        conclusion: null,
        terminalRunnerExitVerified: false,
        observedAtMs: NOW,
        noPaidRetry: true,
        authorizesPaidCall: false,
        authorizesMutation: false,
        independentHeartbeatVerified: false,
        syntheticScopeVerified: false,
        cleanupVerified: false
      };
    },
    readStagingCensus: async () => {
      offlineReads += 1;
      return {};
    },
    readIndependentHeartbeat: async () => {
      offlineReads += 1;
      return null;
    }
  };
  return {
    preview: {
      scope: {
        repository: REPO,
        stagingProjectRef: STAGING,
        mainSha: SHA,
        branch: BRANCH
      },
      currentMain: { repository: REPO, sha: SHA },
      stagingBranchHeadSha: SHA,
      existingPreview: {
        id: PREVIEW,
        repository: REPO,
        projectRef: STAGING,
        branch: BRANCH,
        sha: SHA,
        state: 'READY',
        target: 'preview'
      },
      envMetadata
    },
    supervisor,
    runner: { approved: { ...approved }, observers: observers() },
    now: () => NOW,
    get reads() {
      return offlineReads;
    }
  };
}

test('existing Gate A+B+C contracts execute together but grant NO live authority', async () => {
  const args = inputs();
  const result = await inspect020705CombinedGateABCOffline(args);
  assert.equal(
    result.status,
    'OFFLINE_CONTRACTS_CHECKED_LIVE_GATES_UNVERIFIED'
  );
  assert.equal(result.gateB.branchHeadMatchesMain, true);
  assert.equal(
    result.gateB.status,
    'PREVIEW_METADATA_MATCHES_REQUIRES_INDEPENDENT_APPROVAL'
  );
  assert.equal(result.gateA.state, 'RUNNER_EXIT_NOT_VERIFIED');
  assert.equal(result.gateC.checks.length, 6);
  assert.equal(result.gateC.status, 'SIX_OFFLINE_PROOF_CONTRACTS_MATCH');
  assert.equal(args.reads, 4);
  assert.equal(result.stagingCredentialsVerified, false);
  for (const x of [
    'authorizesExecution',
    'authorizesMutation',
    'authorizesPaidCall'
  ]) {
    assert.equal(result[x], false);
  }
});

test('stale branch SHA stops BEFORE supervisor and runner callbacks', async () => {
  const args = inputs();
  args.preview.stagingBranchHeadSha = 'b'.repeat(40);
  args.runner.observers.readMain = async () => {
    throw new Error('THIS_OBSERVER_MUST_NOT_RUN');
  };
  const x = await inspect020705CombinedGateABCOffline(args);
  assert.equal(x.status, 'PREVIEW_PRECONDITIONS_NO_GO');
  assert.equal(x.gateB.status, 'STAGING_BRANCH_SHA_MISMATCH');
  assert.equal(x.gateA, null);
  assert.equal(x.gateC, null);
  assert.equal(args.reads, 0);
});

test('common Preview secrets are not branch-scoped credentials', async () => {
  const args = inputs();
  args.preview.envMetadata = [
    ...args.preview.envMetadata.filter((v) => v.key !== 'SUPABASE_SECRET_KEY'),
    { key: 'SUPABASE_SECRET_KEY', target: ['preview'] }
  ];
  const x = await inspect020705CombinedGateABCOffline(args);
  assert.equal(x.status, 'PREVIEW_PRECONDITIONS_NO_GO');
  assert.deepEqual(x.gateB.sharedCredentialsNeedingIsolationProof, [
    'SUPABASE_SECRET_KEY'
  ]);
  assert.ok(
    x.gateB.missingBranchScopedEnvNames.includes('SUPABASE_SECRET_KEY')
  );
  assert.equal(args.reads, 0);
});

test('cross-gate SHA/owner mismatch rejects before reading callbacks', async () => {
  for (const mismatch of [
    (a) => {
      a.runner.approved.mainSha = 'b'.repeat(40);
    },
    (a) => {
      a.supervisor.scope.actorId = '22222222-2222-4222-8222-222222222222';
    },
    (a) => {
      a.runner.approved.previewDeploymentId = 'dpl_unrelated';
    }
  ]) {
    const args = inputs();
    mismatch(args);
    await assert.rejects(
      inspect020705CombinedGateABCOffline(args),
      (err) => err.message === 'AI_020705_COMBINED_OFFLINE_DENIED'
    );
    assert.equal(args.reads, 0);
  }
});

test('offline observer exceptions fail closed with no secret in error', async () => {
  const args = inputs();
  args.supervisor.readGithubRunner = async () => {
    throw new Error('PRIVATE_TOKEN_NEVER_LOG');
  };
  await assert.rejects(inspect020705CombinedGateABCOffline(args), (error) => {
    assert.equal(error.message, 'AI_020705_COMBINED_OFFLINE_DENIED');
    assert.doesNotMatch(error.message, /PRIVATE_TOKEN_NEVER_LOG/);
    return true;
  });
});
