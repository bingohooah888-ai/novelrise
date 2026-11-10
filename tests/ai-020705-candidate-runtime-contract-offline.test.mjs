import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import {
  inspect020705OwnerLedger,
  claim020705OwnerApproval
} from '../.github/staging-ai-02-07-05/owner-paid-trial-ledger.mjs';
import { create020705ReadOnlyStageProofs } from '../.github/staging-ai-02-07-05/stage-readonly-proofs.mjs';
import { admit020705SignedWatchdogArmOnce } from '../.github/staging-ai-02-07-05/watchdog-arm-one-use.mjs';
import { createPaidTrialOneShotOpenAiProvider } from '../api/_lib/ai/paid-trial-one-shot-provider.js';

const NOW = Date.parse('2026-11-10T08:00:00Z');
const MAIN = 'a'.repeat(40),
  CANDIDATE = 'b'.repeat(40);
const BRANCH = 'staging/ai-02-07-05-candidate-proof';
const REPO = 'bingohooah888-ai/novelrise';
const PROJECT = 'wmlzjgvxgoyrovdhbqbg';
const URL = 'https://' + PROJECT + '.supabase.co';
const ACTOR = '11111111-1111-4111-8111-111111111111';
const PREVIEW = 'dpl_candidate123',
  CAP = 9000000;
const EXPIRY = new Date(NOW + 1800000).toISOString();
const approved = {
  actorId: ACTOR,
  approvalScope: 'synthetic-one-provider-one-call-only',
  capMicros: CAP,
  confirmation: 'STAGING PAID 1 CALL APPROVED',
  consentRevision: 'test-policy-v1',
  episodeId: 22,
  expiresAt: EXPIRY,
  mainSha: MAIN,
  model: 'gpt-5.6-luna',
  novelId: 11,
  previewDeploymentId: PREVIEW,
  provider: 'openai',
  stagingProjectRef: PROJECT,
  candidateSha: CANDIDATE,
  stagingBranch: BRANCH,
  repository: REPO,
  approvalIssueNumber: 294,
  runId: 1001
};
const scope = {
  repository: REPO,
  stagingProjectRef: PROJECT,
  mainSha: MAIN,
  candidateSha: CANDIDATE,
  stagingBranch: BRANCH,
  capMicros: CAP,
  previewDeploymentId: PREVIEW,
  approvalCommentId: 777,
  runId: 1001,
  actorId: ACTOR,
  novelId: 11,
  episodeId: 22
};
const makeComment = (body) => ({
  id: 777,
  user: { login: 'bingohooah888-ai' },
  author_association: 'OWNER',
  body: 'NOVELIGHT_STAGING_AI_020705_PAID_APPROVE ' + JSON.stringify(body)
});

test('candidate OWNER ledger binds branch, run, main and candidate; replay denied', async () => {
  const comments = [makeComment(approved)];
  const inspect = (expected = approved) =>
    inspect020705OwnerLedger({
      comments,
      approvalCommentId: 777,
      expected,
      now: NOW
    });
  assert.equal(inspect().candidateSha, CANDIDATE);
  const writeComment = async (body) =>
    comments.push({
      id: 778,
      user: { login: 'github-actions[bot]' },
      body
    });
  const run = (id) =>
    claim020705OwnerApproval({
      readComments: async () => comments,
      writeComment,
      approvalCommentId: 777,
      expected: approved,
      runId: id,
      now: () => NOW
    });
  assert.equal((await run(1001)).ownerLedgerClaimed, true);
  const claim = JSON.parse(comments[1].body.split('CLAIMED ')[1]);
  assert.equal(claim.candidateSha, CANDIDATE);
  assert.equal(claim.stagingBranch, BRANCH);
  await assert.rejects(run(1002), /AI_020705_OWNER_LEDGER_DENIED/u);
  for (const change of [
    { candidateSha: MAIN },
    { stagingBranch: 'staging/ai-02-07-05-other' },
    { runId: 999 },
    { repository: 'other/repo' },
    { approvalIssueNumber: 999 }
  ])
    assert.throws(
      () => inspect({ ...approved, ...change }),
      /AI_020705_OWNER_LEDGER_DENIED/u
    );
  assert.throws(
    () =>
      inspect020705OwnerLedger({
        comments: [makeComment({ ...approved, candidateSha: undefined })],
        approvalCommentId: 777,
        expected: approved,
        now: NOW
      }),
    /AI_020705_OWNER_LEDGER_DENIED/u
  );
});

function proofFixture() {
  const observed = {
    readMain: {
      repository: REPO,
      branch: 'main',
      sha: MAIN,
      verifiedReadOnly: true
    },
    readRunnerProtection: {
      repository: REPO,
      runId: 1001,
      actor: 'bingohooah888-ai',
      triggeringActor: 'bingohooah888-ai',
      ref: 'refs/heads/main',
      sha: MAIN,
      environment: 'staging',
      environmentReviewerApproved: true,
      stagingOnlyCredentials: true,
      protectedExecution: true,
      checkoutSha: CANDIDATE,
      stagingBranch: BRANCH,
      candidateCheckoutVerified: true,
      untrustedPrWorkflow: false
    },
    readPreview: {
      id: PREVIEW,
      projectName: 'novelrise',
      repository: REPO,
      gitCommitSha: CANDIDATE,
      gitBranch: BRANCH,
      target: 'preview',
      state: 'READY',
      ssoProtected: true,
      stagingSupabaseUrl: URL,
      ownerPreviewApproved: true
    },
    readCandidateBranch: {
      repository: REPO,
      branch: BRANCH,
      sha: CANDIDATE,
      verifiedReadOnly: true
    },
    readMigration: {
      projectRef: PROJECT,
      supabaseUrl: URL,
      migrationVersion: '20261101060000_novelight_ai_020705_one_shot_claim',
      applied: true,
      oneShotFunctionPresent: true,
      serviceRoleOnly: true
    },
    readSyntheticConsent: {
      projectRef: PROJECT,
      actorId: ACTOR,
      novelId: 11,
      episodeId: 22,
      chunkIndex: 0,
      verifiedSynthetic: true,
      explicitOwnerConsent: true,
      consentRevision: approved.consentRevision,
      expiresAt: EXPIRY
    },
    readBillingProtection: {
      provider: 'openai',
      model: 'gpt-5.6-luna',
      currency: 'JPY',
      providerAccountVerified: true,
      currentOfficialRatesVerified: true,
      exchangeRateVerified: true,
      singleAttemptNoRetry: true,
      capEnforcedExternally: true,
      worstCaseTotalMicros: CAP
    }
  };
  const observers = Object.fromEntries(
    Object.entries(observed).map(([key, value]) => [key, async () => value])
  );
  return {
    observed,
    proofs: create020705ReadOnlyStageProofs({
      approved: { ...approved, approvalCommentId: 777 },
      observers,
      now: () => NOW
    })
  };
}

test('candidate proof requires separate main, trusted runner, branch and Preview SHA', async () => {
  const names = [
    'verifyCurrentMain',
    'verifyProtectedRunner',
    'verifyApprovedPreview',
    'verifyAtomicMigration',
    'verifySyntheticConsent',
    'verifyProviderBillingLimit'
  ];
  const positive = proofFixture();
  for (const name of names)
    assert.equal(await positive.proofs[name](scope), true, name);
  for (const [key, field, value, proof] of [
    ['readRunnerProtection', 'sha', CANDIDATE, 'verifyProtectedRunner'],
    ['readRunnerProtection', 'checkoutSha', MAIN, 'verifyProtectedRunner'],
    [
      'readRunnerProtection',
      'untrustedPrWorkflow',
      true,
      'verifyProtectedRunner'
    ],
    ['readPreview', 'gitCommitSha', MAIN, 'verifyApprovedPreview'],
    ['readPreview', 'gitBranch', 'main', 'verifyApprovedPreview'],
    ['readPreview', 'target', 'production', 'verifyApprovedPreview'],
    ['readCandidateBranch', 'sha', MAIN, 'verifyApprovedPreview']
  ]) {
    const fixture = proofFixture();
    fixture.observed[key][field] = value;
    assert.equal(await fixture.proofs[proof](scope), false, key + '.' + field);
  }
  assert.equal(
    await proofFixture().proofs.verifyCurrentMain({
      ...scope,
      candidateSha: MAIN
    }),
    false
  );
});

const keys = generateKeyPairSync('ed25519');
const nonce = 'A'.repeat(44),
  keyId = 'candidate-controller-01';
function envelope() {
  const receipt = {
    ...scope,
    kind: 'independent-controller-armed',
    protectedEnvironment: 'staging',
    controllerKind: 'external-independent-supervisor',
    controllerRunId: 4004,
    controllerIsRunner: false,
    killAuthorityVerified: true,
    stagingDisableVerified: true,
    sessionRevocationVerified: true,
    syntheticCleanupVerified: true,
    zeroCensusVerified: true,
    noPaidRetry: true,
    observedAtMs: NOW,
    heartbeatAtMs: NOW,
    expiresAtMs: NOW + 15000
  };
  const domain = 'NOVELIGHT_AI_020705_WATCHDOG_ARM_V1';
  return {
    domain,
    keyId,
    challengeNonce: nonce,
    receipt,
    signature: sign(
      null,
      Buffer.from(JSON.stringify([domain, keyId, nonce, receipt]), 'utf8'),
      keys.privateKey
    ).toString('base64url')
  };
}
test('signed watchdog candidate scope is one-use and cannot be down-scoped', async () => {
  const bindings = [],
    used = new Set();
  const args = {
    scope,
    envelope: envelope(),
    trustedControllerPublicKey: keys.publicKey,
    trustedControllerKeyId: keyId,
    expectedChallengeNonce: nonce,
    consumeChallengeOnce: async (binding) => {
      bindings.push(binding);
      const key = JSON.stringify(binding);
      if (used.has(key)) return false;
      used.add(key);
      return true;
    },
    now: () => NOW
  };
  assert.equal(await admit020705SignedWatchdogArmOnce(args), true);
  assert.equal(bindings[0].candidateSha, CANDIDATE);
  assert.equal(bindings[0].stagingBranch, BRANCH);
  assert.equal(bindings[0].capMicros, CAP);
  assert.equal(await admit020705SignedWatchdogArmOnce(args), false);
  for (const changed of [
    { candidateSha: MAIN },
    { stagingBranch: 'staging/ai-02-07-05-other' },
    { capMicros: CAP + 1 }
  ])
    assert.equal(
      await admit020705SignedWatchdogArmOnce({
        ...args,
        scope: { ...scope, ...changed }
      }),
      false
    );
  assert.equal(bindings.length, 2);
});

test('one-shot Staging DB claim stores tested candidate SHA; no model retry', async () => {
  const params = [];
  let calls = 0;
  const approvedProvider = {
    commentId: 777,
    ownerId: ACTOR,
    novelId: 11,
    episodeId: 22,
    provider: 'openai',
    model: 'gpt-5.6-luna',
    routeCount: 1,
    maxProviderCalls: 1,
    noRetry: true,
    fallbackDisabled: true,
    capMicros: CAP,
    mainSha: MAIN,
    candidateSha: CANDIDATE,
    stagingBranch: BRANCH,
    previewDeploymentId: PREVIEW,
    expiresAt: EXPIRY,
    ownerLedgerClaimed: true,
    exactScopeVerified: true
  };
  const deployment = {
    projectRef: PROJECT,
    supabaseUrl: URL,
    isProduction: false,
    ready: true,
    branch: BRANCH,
    sha: CANDIDATE,
    id: PREVIEW
  };
  const serviceClient = {
    supabaseUrl: URL,
    rpc: async (_name, input) => {
      params.push(input);
      return { data: params.length === 1, error: null };
    }
  };
  const options = {
    approved: approvedProvider,
    deployment,
    serviceClient,
    now: () => NOW,
    underlyingProvider: {
      generate: async () => {
        calls++;
        return { text: 'synthetic' };
      }
    }
  };
  const provider = createPaidTrialOneShotOpenAiProvider(options);
  assert.equal(
    (await provider.generate({ model: 'gpt-5.6-luna' })).text,
    'synthetic'
  );
  await assert.rejects(
    provider.generate({ model: 'gpt-5.6-luna' }),
    /AI_020705_PAID_ONE_SHOT_DENIED/u
  );
  assert.equal(params[0].p_main_sha, CANDIDATE);
  assert.equal(params[0].p_approval_comment_id, 777);
  assert.equal(calls, 1);
  for (const bad of [
    { candidateSha: MAIN },
    { stagingBranch: 'staging/ai-02-07-05-other' },
    { candidateSha: undefined },
    { capMicros: CAP + 1000001 }
  ])
    assert.throws(
      () =>
        createPaidTrialOneShotOpenAiProvider({
          ...options,
          approved: { ...approvedProvider, ...bad }
        }),
      /AI_020705_PAID_ONE_SHOT_DENIED/u
    );
});

test('candidate protected runner accepts only main-sourced trusted workflow and exact checkout', async () => {
  const { create020705ProtectedStageExecutor } =
    await import('../.github/staging-ai-02-07-05/protected-stage-executor.mjs');
  const serviceClient = {
    supabaseUrl: URL,
    rpc: async () => ({ data: false }),
    from: () => ({})
  };
  const approvedProvider = {
    commentId: 777,
    ownerId: ACTOR,
    novelId: 11,
    episodeId: 22,
    provider: 'openai',
    model: 'gpt-5.6-luna',
    routeCount: 1,
    maxProviderCalls: 1,
    noRetry: true,
    fallbackDisabled: true,
    capMicros: CAP,
    mainSha: MAIN,
    candidateSha: CANDIDATE,
    stagingBranch: BRANCH,
    previewDeploymentId: PREVIEW,
    expiresAt: EXPIRY,
    ownerLedgerClaimed: true,
    exactScopeVerified: true
  };
  const guardedProvider = createPaidTrialOneShotOpenAiProvider({
    approved: approvedProvider,
    deployment: {
      projectRef: PROJECT,
      supabaseUrl: URL,
      isProduction: false,
      ready: true,
      branch: BRANCH,
      sha: CANDIDATE,
      id: PREVIEW
    },
    serviceClient,
    now: () => NOW,
    underlyingProvider: { generate: async () => ({ text: 'synthetic' }) }
  });
  const context = {
    repository: REPO,
    githubActor: 'bingohooah888-ai',
    triggeringActor: 'bingohooah888-ai',
    protectedEnvironment: 'staging',
    trustedRef: 'refs/heads/main',
    trustedSha: MAIN,
    vercelTarget: 'preview',
    projectRef: PROJECT,
    supabaseUrl: URL,
    mainSha: MAIN,
    candidateSha: CANDIDATE,
    stagingBranch: BRANCH,
    candidateCheckoutSha: CANDIDATE,
    previewDeploymentId: PREVIEW,
    approvalCommentId: 777,
    runId: 1001
  };
  const runnerExpected = {
    mainSha: MAIN,
    candidateSha: CANDIDATE,
    stagingBranch: BRANCH,
    stagingProjectRef: PROJECT,
    actorId: ACTOR,
    novelId: 11,
    episodeId: 22,
    capMicros: CAP,
    previewDeploymentId: PREVIEW,
    provider: 'openai',
    model: 'gpt-5.6-luna'
  };
  const options = {
    context,
    expected: runnerExpected,
    synthetic: {
      userId: ACTOR,
      novelId: 11,
      approvalCommentId: 777,
      projectRef: PROJECT,
      supabaseUrl: URL,
      verifiedSynthetic: true
    },
    serviceClient,
    authAdmin: { getUserById: async () => ({}), deleteUser: async () => ({}) },
    guardedProvider,
    request: { model: 'gpt-5.6-luna', system: 'offline', user: 'synthetic' },
    readComments: async () => [],
    writeComment: async () => {},
    disableTrialEnvironment: async () => true,
    revokeSyntheticSessions: async () => true,
    independentCensus: async () => ({}),
    readIndependentWatchdogArm: async () => null,
    trustedControllerPublicKey: keys.publicKey,
    trustedControllerKeyId: keyId,
    expectedChallengeNonce: nonce,
    consumeWatchdogChallengeOnce: async () => false,
    proofs: Object.fromEntries(
      [
        'verifyCurrentMain',
        'verifyProtectedRunner',
        'verifyApprovedPreview',
        'verifyAtomicMigration',
        'verifySyntheticConsent',
        'verifyProviderBillingLimit'
      ].map((name) => [name, async () => false])
    ),
    now: () => NOW
  };
  assert.equal(
    typeof create020705ProtectedStageExecutor(options).run,
    'function'
  );
  for (const changes of [
    { candidateCheckoutSha: MAIN },
    { trustedRef: 'refs/heads/' + BRANCH },
    { trustedSha: CANDIDATE },
    { stagingBranch: 'staging/ai-02-07-05-other' },
    { candidateSha: MAIN },
    { protectedEnvironment: 'production' }
  ])
    assert.throws(
      () =>
        create020705ProtectedStageExecutor({
          ...options,
          context: { ...context, ...changes }
        }),
      /AI_020705_PROTECTED_STAGE_DENIED/u
    );
  await assert.rejects(
    create020705ProtectedStageExecutor(options).run(),
    /AI_020705_PROTECTED_STAGE_DENIED/u
  );
});
