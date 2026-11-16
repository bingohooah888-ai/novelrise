import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

// prettier-ignore
import { inspect020705IndependentGateABeforeMutation, create020705CloudflareDeathReceiptReader } from '../.github/ai-02-07-05-app-composition/staging-live-bindings.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const MAIN = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const NONCE = 'A'.repeat(44);
const KEYID = 'independent-gatea-01';
const NOW = Date.parse('2026-11-16T12:30:00Z');
const keys = generateKeyPairSync('ed25519');

// prettier-ignore
const scope = Object.freeze({
  repository: REPO,
  stagingProjectRef: STAGING,
  supabaseUrl: 'https://' + STAGING + '.supabase.co',
  mainSha: MAIN,
  candidateSha: HEAD,
  stagingBranch: 'staging/ai-02-07-05-owner-proof',
  capMicros: 1000000,
  previewDeploymentId: 'dpl_test123',
  actorId: '11111111-1111-4111-8111-111111111111',
  novelId: 998892071,
  episodeId: 998892072,
  runId: 700,
  approvalCommentId: 601
});

function signed(domain, field, receipt) {
  return {
    domain, keyId: KEYID, challengeNonce: NONCE,
    [field]: receipt,
    signature: sign(null, Buffer.from(JSON.stringify([
      domain, KEYID, NONCE, receipt
    ])), keys.privateKey).toString('base64url')
  };
}

function activeArmReceipt() {
  return {
    repository: REPO, stagingProjectRef: STAGING,
    mainSha: MAIN, candidateSha: HEAD,
    stagingBranch: scope.stagingBranch,
    capMicros: scope.capMicros,
    previewDeploymentId: scope.previewDeploymentId,
    actorId: scope.actorId, novelId: scope.novelId,
    episodeId: scope.episodeId, runId: scope.runId,
    approvalCommentId: scope.approvalCommentId,
    kind: 'independent-controller-armed',
    protectedEnvironment: 'staging',
    controllerKind: 'external-independent-supervisor',
    controllerRunId: 701,
    controllerIsRunner: false,
    killAuthorityVerified: true,
    stagingDisableVerified: true,
    sessionRevocationVerified: true,
    syntheticCleanupVerified: true,
    zeroCensusVerified: true,
    noPaidRetry: true,
    observedAtMs: NOW - 1500,
    heartbeatAtMs: NOW - 2000,
    expiresAtMs: NOW + 10000
  };
}

function independentController(envelope) {
  return {
    trustedControllerPublicKey: keys.publicKey,
    trustedControllerKeyId: KEYID,
    expectedChallengeNonce: NONCE,
    verifyIndependentController: async () => true,
    readIndependentWatchdogArm: async () => envelope
  };
}

// prettier-ignore
test('only independently signed fresh live Gate A arm can pass pre-mutation check', async () => {
  const receipt = activeArmReceipt();
  const envelope = signed('NOVELIGHT_AI_020705_WATCHDOG_ARM_V1',
    'receipt', receipt);
  const controller = independentController(envelope);
  assert.equal(await inspect020705IndependentGateABeforeMutation({
    scope, controller, now: () => NOW
  }), true);

  assert.equal(await inspect020705IndependentGateABeforeMutation({
    scope, controller: independentController({
      ...envelope, signature: 'A'.repeat(86)
    }), now: () => NOW
  }), false);
  assert.equal(await inspect020705IndependentGateABeforeMutation({
    scope, controller: independentController(signed(
      'NOVELIGHT_AI_020705_WATCHDOG_ARM_V1',
      'receipt', { ...receipt, killAuthorityVerified: false }
    )), now: () => NOW
  }), false);
  assert.equal(await inspect020705IndependentGateABeforeMutation({
    scope, controller, now: () => NOW + 35000
  }), false);
  assert.equal(await inspect020705IndependentGateABeforeMutation({
    scope, controller: { ...controller,
      verifyIndependentController: async () => false
    }, now: () => NOW
  }), false);
});

function deathReceipt() {
  return {
    repository: REPO, stagingProjectRef: STAGING,
    mainSha: MAIN, previewDeploymentId: scope.previewDeploymentId,
    actorId: scope.actorId, novelId: scope.novelId,
    episodeId: scope.episodeId,
    runId: scope.runId, approvalCommentId: scope.approvalCommentId,
    kind: 'detached-controller-runner-death',
    runnerConfirmedDead: true,
    controllerIsRunner: false,
    controllerRunId: 701,
    observedAtMs: NOW,
    runnerHeartbeatAtMs: NOW - 1000,
    expiresAtMs: NOW + 10000
  };
}

// prettier-ignore
function recoveryFixture({ httpStatus = 200, tamper = false } = {}) {
  const actions = [];
  const envelope = signed('NOVELIGHT_AI_020705_DETACHED_DEATH_V1',
    'proof', deathReceipt());
  const reader = create020705CloudflareDeathReceiptReader({
    scope,
    workerOrigin: 'https://novelight-ai-gatea-watchdog.testaccount.workers.dev',
    ownerReadSignature: 'B'.repeat(86),
    challengeNonce: NONCE,
    trustedControllerPublicKey: keys.publicKey,
    trustedControllerKeyId: KEYID,
    async fetchImpl(url, options) {
      actions.push({ url, options });
      const input = JSON.parse(options.body);
      assert.equal(options.method, 'POST');
      assert.equal(input.scope.runId, scope.runId);
      assert.equal(input.scope.repository, REPO);
      assert.equal(input.scope.candidateSha, undefined);
      assert.ok(url.endsWith('/_novelight/gatea/receipt'));
      return {
        status: httpStatus,
        headers: { get: () => 'application/json' },
        async text() {
          return JSON.stringify({
            envelope: tamper
              ? { ...envelope, signature: 'A'.repeat(86) }
              : envelope,
            authorizesMutation: false,
            authorizesPaidCall: false
          });
        }
      };
    }
  });
  return { reader, actions, envelope };
}

test('Cloudflare detached death receipt is read only, cryptographically verified, and one-use', async () => {
  const { reader, actions, envelope } = recoveryFixture();
  assert.equal(actions.length, 0);
  const result = await reader.readIndependentDeathProof(scope);
  assert.deepEqual(result, envelope);
  assert.equal(actions.length, 1);
  await assert.rejects(reader.readIndependentDeathProof(scope),
    /AI_020705_STAGING_BINDING_DENIED/u);
  assert.equal(actions.length, 1);
});

test('unreachable Cloudflare, forged signature, wrong scope, or unapproved domain deny', async () => {
  for (const args of [{ httpStatus: 404 }, { tamper: true }]) {
    const { reader } = recoveryFixture(args);
    await assert.rejects(reader.readIndependentDeathProof(scope),
      /AI_020705_STAGING_BINDING_DENIED/u);
  }
  const { reader } = recoveryFixture();
  await assert.rejects(reader.readIndependentDeathProof({
    ...scope, runId: 702
  }), /AI_020705_STAGING_BINDING_DENIED/u);
  assert.throws(() => create020705CloudflareDeathReceiptReader({
    scope,
    workerOrigin: 'https://novelight-ai-gatea-watchdog.attacker.example',
    ownerReadSignature: 'B'.repeat(86),
    challengeNonce: NONCE,
    trustedControllerPublicKey: keys.publicKey,
    trustedControllerKeyId: KEYID
  }), /AI_020705_STAGING_BINDING_DENIED/u);
});
