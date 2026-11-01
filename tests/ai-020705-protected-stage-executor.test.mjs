import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
// prettier-ignore
import { create020705ProtectedStageExecutor } from
  '../.github/staging-ai-02-07-05/protected-stage-executor.mjs';
// prettier-ignore
import { createPaidTrialOneShotOpenAiProvider } from
  '../api/_lib/ai/paid-trial-one-shot-provider.js';

const NOW = Date.parse('2026-11-01T08:00:00Z');
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const SHA = 'a'.repeat(40);
const PREVIEW = 'dpl_test123';
const STAGING_URL = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
const WATCHDOG_DOMAIN = 'NOVELIGHT_AI_020705_WATCHDOG_ARM_V1';
const WATCHDOG_KEY_ID = 'synthetic-controller-key-01';
const WATCHDOG_NONCE = 'A'.repeat(44);
const WATCHDOG_KEYS = generateKeyPairSync('ed25519');

// Synthetic signing fixture. Does not establish external controller identity.
// prettier-ignore
function signedArm(scope, key = WATCHDOG_KEYS.privateKey) {
  const receipt = {
    ...scope,
    kind: 'independent-controller-armed',
    protectedEnvironment: 'staging',
    controllerKind: 'external-independent-supervisor',
    controllerRunId: 3001,
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
  const signature = sign(null, Buffer.from(JSON.stringify([
    WATCHDOG_DOMAIN, WATCHDOG_KEY_ID, WATCHDOG_NONCE, receipt
  ]), 'utf8'), key).toString('base64url');
  return {
    domain: WATCHDOG_DOMAIN,
    keyId: WATCHDOG_KEY_ID,
    challengeNonce: WATCHDOG_NONCE,
    receipt,
    signature
  };
}
// prettier-ignore
const ZERO = [
  'users', 'identities', 'sessions', 'profiles', 'novels', 'episodes',
  'facts', 'analysis', 'reviewCandidates', 'consents', 'consentAudit',
  'usageRequests', 'usageAudit'
];

// prettier-ignore
function setup({ failedModel = false, failedStop = false, failedCensus = false } = {}) {
  const actions = [];
  const approvalCommentId = 777;
  const expiresAt = new Date(NOW + 1800000).toISOString();
  const approval = {
    actorId: OWNER_ID,
    approvalScope: 'synthetic-one-provider-one-call-only',
    capMicros: 2528640,
    confirmation: 'STAGING PAID 1 CALL APPROVED',
    consentRevision: 'test-policy-v1',
    episodeId: 11,
    expiresAt,
    mainSha: SHA,
    model: 'gpt-5.6-luna',
    novelId: 41,
    previewDeploymentId: PREVIEW,
    provider: 'openai',
    stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg'
  };
  const comments = [{
    id: approvalCommentId,
    user: { login: 'bingohooah888-ai' },
    author_association: 'OWNER',
    body: 'NOVELIGHT_STAGING_AI_020705_PAID_APPROVE ' +
      JSON.stringify(approval)
  }];
  let modelCalls = 0;
  let dbClaimed = false;
  let watchdogConsumed = false;
  function dbChain() {
    const chain = {
      eq() { return chain; },
      maybeSingle: async () => ({
        error: null,
        data: { id: 41, user_id: OWNER_ID }
      }),
      then(resolve) { resolve({ error: null }); }
    };
    return chain;
  }
  const serviceClient = {
    supabaseUrl: STAGING_URL,
    async rpc() {
      actions.push('db-claim');
      if (dbClaimed) return { error: null, data: false };
      dbClaimed = true;
      return { error: null, data: true };
    },
    from(table) {
      return {
        update() { actions.push('stop-db'); return dbChain(); },
        delete() { actions.push('delete-' + table); return dbChain(); },
        select() { return dbChain(); }
      };
    }
  };
  const synthetic = {
    verifiedSynthetic: true,
    supabaseUrl: STAGING_URL,
    projectRef: 'wmlzjgvxgoyrovdhbqbg',
    userId: OWNER_ID,
    novelId: 41,
    approvalCommentId
  };
  const authAdmin = {
    getUserById: async () => ({
      data: {
        user: {
          id: OWNER_ID,
          email: 'novelight-ai-020705-synthetic@example.invalid',
          app_metadata: { internal_e2e: true }
        }
      },
      error: null
    }),
    deleteUser: async () => { actions.push('delete-user'); return { error: null }; }
  };
  const guardedProvider = createPaidTrialOneShotOpenAiProvider({
    serviceClient,
    now: () => NOW,
    approved: {
      commentId: approvalCommentId,
      ownerId: OWNER_ID,
      novelId: 41,
      episodeId: 11,
      provider: 'openai',
      model: 'gpt-5.6-luna',
      routeCount: 1,
      maxProviderCalls: 1,
      noRetry: true,
      fallbackDisabled: true,
      capMicros: approval.capMicros,
      mainSha: SHA,
      previewDeploymentId: PREVIEW,
      expiresAt,
      ownerLedgerClaimed: true,
      exactScopeVerified: true
    },
    deployment: {
      projectRef: synthetic.projectRef,
      supabaseUrl: STAGING_URL,
      isProduction: false,
      ready: true,
      sha: SHA,
      id: PREVIEW
    },
    underlyingProvider: {
      async generate() {
        actions.push('model');
        modelCalls += 1;
        if (failedModel) throw new Error('SENSITIVE_RAW_ERROR');
        return { text: '{"suggestions":[]}' };
      }
    }
  });
  const context = {
    repository: 'bingohooah888-ai/novelrise',
    githubActor: 'bingohooah888-ai',
    triggeringActor: 'bingohooah888-ai',
    protectedEnvironment: 'staging',
    trustedRef: 'refs/heads/main',
    vercelTarget: 'preview',
    projectRef: synthetic.projectRef,
    supabaseUrl: STAGING_URL,
    mainSha: SHA,
    previewDeploymentId: PREVIEW,
    approvalCommentId,
    runId: 1001
  };
  const expected = {
    actorId: OWNER_ID,
    novelId: 41,
    episodeId: 11,
    mainSha: SHA,
    previewDeploymentId: PREVIEW,
    capMicros: approval.capMicros,
    provider: 'openai',
    model: 'gpt-5.6-luna',
    stagingProjectRef: synthetic.projectRef
  };
  const proofs = Object.fromEntries([
    'verifyCurrentMain', 'verifyProtectedRunner', 'verifyApprovedPreview',
    'verifyAtomicMigration', 'verifySyntheticConsent',
    'verifyProviderBillingLimit'
  ].map((name) => [name, async () => {
    actions.push(name);
    return true;
  }]));
  const options = {
    context,
    expected,
    synthetic,
    serviceClient,
    authAdmin,
    guardedProvider,
    request: { model: 'gpt-5.6-luna', system: 'synthetic', user: 'synthetic story' },
    readComments: async () => comments,
    async writeComment(body) {
      actions.push(body.includes('_CLAIMED ') ? 'github-claim' : 'github-consumed');
      comments.push({
        id: 900 + comments.length,
        user: { login: 'github-actions[bot]' },
        body
      });
    },
    disableTrialEnvironment: async () => {
      actions.push('stop-environment');
      return !failedStop;
    },
    revokeSyntheticSessions: async () => {
      actions.push('revoke-sessions');
      return true;
    },
    independentCensus: async () => {
      actions.push('census');
      return {
        projectRef: synthetic.projectRef,
        runtimeDisabledZero: !failedCensus,
        approvalTombstoneCount: 1,
        ...Object.fromEntries(ZERO.map((key) => [key, 0]))
      };
    },
    proofs,
    trustedControllerPublicKey: WATCHDOG_KEYS.publicKey,
    trustedControllerKeyId: WATCHDOG_KEY_ID,
    expectedChallengeNonce: WATCHDOG_NONCE,
    consumeWatchdogChallengeOnce: async (binding) => {
      actions.push('watchdog-one-use');
      if (binding.mainSha !== SHA || binding.nonce !== WATCHDOG_NONCE ||
          binding.approvalCommentId !== approvalCommentId || watchdogConsumed) {
        return false;
      }
      watchdogConsumed = true;
      return true;
    },
    readIndependentWatchdogArm: async (scope) => {
      actions.push('watchdog-arm');
      return signedArm(scope);
    },
    now: () => NOW
  };
  return { options, actions, calls: () => modelCalls, comments };
}

// prettier-ignore
test('preflight, one paid attempt, stop, cleanup, census, consume in strict order', async () => {
  const { options, actions, calls } = setup();
  const runner = create020705ProtectedStageExecutor(options);
  const result = await runner.run();
  assert.equal(result.outcome, 'one_call_succeeded_and_cleanup_verified');
  assert.equal(calls(), 1);
  assert.equal(actions[0], 'verifyCurrentMain');
  assert.equal(actions[5], 'verifyProviderBillingLimit');
  assert.ok(actions.indexOf('watchdog-arm') < actions.indexOf('watchdog-one-use'));
  assert.ok(actions.indexOf('watchdog-one-use') < actions.indexOf('github-claim'));
  assert.ok(actions.indexOf('github-claim') < actions.indexOf('db-claim'));
  assert.ok(actions.indexOf('db-claim') < actions.indexOf('model'));
  assert.ok(actions.indexOf('model') < actions.indexOf('stop-db'));
  assert.ok(actions.indexOf('stop-environment') < actions.indexOf('revoke-sessions'));
  assert.ok(actions.indexOf('delete-user') < actions.indexOf('census'));
  assert.equal(actions.at(-1), 'github-consumed');
  await assert.rejects(runner.run(), /AI_020705_PROTECTED_STAGE_DENIED/u);
  assert.equal(calls(), 1);
});

// prettier-ignore
test('failed proof cannot CLAIM, write to DB or call model', async () => {
  const { options, actions, calls } = setup();
  options.proofs.verifyApprovedPreview = async () => false;
  const runner = create020705ProtectedStageExecutor(options);
  await assert.rejects(runner.run(), /AI_020705_PROTECTED_STAGE_DENIED/u);
  assert.equal(calls(), 0);
  assert.equal(actions.includes('github-claim'), false);
  assert.equal(actions.includes('db-claim'), false);
});

// prettier-ignore
test('production, mismatched provider scope or unprotected execution is denied', () => {
  const factory = () => setup().options;
  assert.throws(() => create020705ProtectedStageExecutor({
    ...factory(),
    context: { ...factory().context, protectedEnvironment: 'production' }
  }), /AI_020705_PROTECTED_STAGE_DENIED/u);
  const config = factory();
  config.expected.novelId = 99;
  assert.throws(
    () => create020705ProtectedStageExecutor(config),
    /AI_020705_PROTECTED_STAGE_DENIED/u
  );
  const second = factory();
  second.context.approvalCommentId = 778;
  second.synthetic.approvalCommentId = 778;
  assert.throws(
    () => create020705ProtectedStageExecutor(second),
    /AI_020705_PROTECTED_STAGE_DENIED/u
  );
});

// prettier-ignore
test('model failure is consumed and sanitised, no retry', async () => {
  const { options, actions, calls } = setup({ failedModel: true });
  const runner = create020705ProtectedStageExecutor(options);
  await assert.rejects(runner.run(), /AI_020705_PAID_ATTEMPT_FAILED_NO_RETRY/u);
  assert.equal(calls(), 1);
  assert.equal(actions.at(-1), 'github-consumed');
  assert.ok(actions.includes('census'));
});

// prettier-ignore
test('failure of stop or independent census is fatal and still consumed', async () => {
  for (const config of [{ failedStop: true }, { failedCensus: true }]) {
    const { options, actions, calls } = setup(config);
    await assert.rejects(
      create020705ProtectedStageExecutor(options).run(),
      /AI_020705_PAID_CLEANUP_UNVERIFIED/u
    );
    assert.equal(calls(), 1);
    assert.equal(actions.at(-1), 'github-consumed');
  }
});

// prettier-ignore
test('offline workflow remains unwired: no paid stage, secrets or mutations', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/ai-020705-owner-staging-paid-trial.yml', import.meta.url),
    'utf8'
  );
  assert.match(workflow, /OFFLINE preflight only/u);
  assert.doesNotMatch(workflow, /protected-stage-executor\.mjs/u);
  assert.doesNotMatch(workflow, /secrets\./u);
  assert.doesNotMatch(workflow, /issues: write/u);
});

// prettier-ignore
test('missing or failed external watchdog arm cannot claim or call model', async () => {
  for (const mode of ['missing', 'null', 'throws', 'wrongScope']) {
    const { options, actions, calls } = setup();
    if (mode === 'missing') delete options.readIndependentWatchdogArm;
    if (mode === 'null') options.readIndependentWatchdogArm = async () => null;
    if (mode === 'throws') options.readIndependentWatchdogArm = async () => {
      throw new Error('PRIVATE_CONTROLLER_SECRET');
    };
    if (mode === 'wrongScope') options.readIndependentWatchdogArm = async () => ({
      kind: 'independent-controller-armed', mainSha: 'b'.repeat(40)
    });
    if (mode === 'missing') {
      assert.throws(() => create020705ProtectedStageExecutor(options),
        /AI_020705_PROTECTED_STAGE_DENIED/u);
    } else {
      await assert.rejects(create020705ProtectedStageExecutor(options).run(),
        e => e.message === 'AI_020705_PROTECTED_STAGE_DENIED');
    }
    assert.equal(actions.includes('github-claim'), false);
    assert.equal(actions.includes('db-claim'), false);
    assert.equal(calls(), 0);
  }
});

// prettier-ignore
test('forged signature, wrong trusted key or nonce, and non-atomic consumer deny before CLAIM', async () => {
  const attacker = generateKeyPairSync('ed25519');
  for (const mode of [
    'forged', 'wrong-key', 'wrong-nonce',
    'denied-consumer', 'throwing-consumer', 'missing-consumer'
  ]) {
    const { options, actions, calls } = setup();
    if (mode === 'forged') options.readIndependentWatchdogArm = async (scope) =>
      signedArm(scope, attacker.privateKey);
    if (mode === 'wrong-key') options.trustedControllerKeyId = 'attacker-key-id';
    if (mode === 'wrong-nonce') options.expectedChallengeNonce = 'B'.repeat(44);
    if (mode === 'denied-consumer') options.consumeWatchdogChallengeOnce =
      async () => false;
    if (mode === 'throwing-consumer') options.consumeWatchdogChallengeOnce =
      async () => { throw new Error('SENSITIVE_DO_NOT_ECHO'); };
    if (mode === 'missing-consumer') delete options.consumeWatchdogChallengeOnce;
    if (mode === 'missing-consumer') {
      assert.throws(() => create020705ProtectedStageExecutor(options),
        /AI_020705_PROTECTED_STAGE_DENIED/u);
    } else {
      await assert.rejects(create020705ProtectedStageExecutor(options).run(),
        /AI_020705_PROTECTED_STAGE_DENIED/u);
    }
    assert.equal(actions.includes('github-claim'), false);
    assert.equal(actions.includes('db-claim'), false);
    assert.equal(calls(), 0);
  }
});

// prettier-ignore
test('fresh executor cannot re-consume the same signed arm challenge', async () => {
  const { options, actions, calls } = setup();
  const first = await create020705ProtectedStageExecutor(options).run();
  assert.equal(first.outcome, 'one_call_succeeded_and_cleanup_verified');
  await assert.rejects(create020705ProtectedStageExecutor(options).run(),
    /AI_020705_PROTECTED_STAGE_DENIED/u);
  assert.equal(actions.filter((x) => x === 'watchdog-one-use').length, 2);
  assert.equal(actions.filter((x) => x === 'github-claim').length, 1);
  assert.equal(calls(), 1);
});
