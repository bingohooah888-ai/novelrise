import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
// prettier-ignore
import { admit020705SignedWatchdogArmOnce } from
  '../.github/staging-ai-02-07-05/watchdog-arm-one-use.mjs';

const NOW = Date.parse('2026-11-01T08:00:00Z');
const DOMAIN = 'NOVELIGHT_AI_020705_WATCHDOG_ARM_V1';
const NONCE = 'A'.repeat(44);
const KEY_ID = 'synthetic-controller-key-01';
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const attacker = generateKeyPairSync('ed25519');
// prettier-ignore
const scope = Object.freeze({
  repository: 'bingohooah888-ai/novelrise',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
  mainSha: 'a'.repeat(40), previewDeploymentId: 'dpl_synthetic123',
  actorId: '11111111-1111-4111-8111-111111111111',
  runId: 1001, approvalCommentId: 777, novelId: 41, episodeId: 11
});
// prettier-ignore
function envelope(key = privateKey) {
  const receipt = {
    ...scope, kind: 'independent-controller-armed',
    protectedEnvironment: 'staging',
    controllerKind: 'external-independent-supervisor',
    controllerRunId: 3001, controllerIsRunner: false,
    killAuthorityVerified: true, stagingDisableVerified: true,
    sessionRevocationVerified: true, syntheticCleanupVerified: true,
    zeroCensusVerified: true, noPaidRetry: true,
    observedAtMs: NOW, heartbeatAtMs: NOW - 1000,
    expiresAtMs: NOW + 10000
  };
  const signature = sign(null, Buffer.from(JSON.stringify([
    DOMAIN, KEY_ID, NONCE, receipt
  ]), 'utf8'), key).toString('base64url');
  return {
    domain: DOMAIN, keyId: KEY_ID,
    challengeNonce: NONCE, receipt, signature
  };
}
// In-memory simulation ONLY, never durable or acceptable in a live runner.
// prettier-ignore
function atomicMock() {
  const consumed = new Set();
  return async (binding) => {
    await Promise.resolve();
    const key = JSON.stringify(binding);
    if (consumed.has(key)) return false;
    consumed.add(key);
    return true;
  };
}
// prettier-ignore
function run(consumeChallengeOnce, changes = {}) {
  return admit020705SignedWatchdogArmOnce({
    scope, envelope: envelope(), trustedControllerPublicKey: publicKey,
    trustedControllerKeyId: KEY_ID, expectedChallengeNonce: NONCE,
    consumeChallengeOnce, now: () => NOW, ...changes
  });
}

// prettier-ignore
test('signed synthetic arm admits exactly once under an atomic mock', async () => {
  const ledger = atomicMock();
  assert.equal(await run(ledger), true);
  assert.equal(await run(ledger), false);
});

// prettier-ignore
test('20 concurrent admissions of a single challenge admit only one', async () => {
  const ledger = atomicMock();
  const results = await Promise.all(Array.from({length: 20}, () => run(ledger)));
  assert.equal(results.filter(Boolean).length, 1);
});

// prettier-ignore
test('untrusted signature and wrong scope never consume the challenge', async () => {
  const ledger = atomicMock();
  let writes = 0;
  const consume = async (binding) => {
    writes += 1;
    return ledger(binding);
  };
  assert.equal(await run(consume, {envelope: envelope(attacker.privateKey)}), false);
  assert.equal(await run(consume, {expectedChallengeNonce: 'B'.repeat(44)}), false);
  assert.equal(await run(consume, {scope: {...scope, mainSha: 'b'.repeat(40)}}), false);
  assert.equal(writes, 0);
  assert.equal(await run(consume), true);
  assert.equal(writes, 1);
});

// prettier-ignore
test('missing, throwing, or nonboolean consumer is fail-closed', async () => {
  assert.equal(await run(undefined), false);
  assert.equal(await run(async () => {throw new Error('SECRET_DO_NOT_ECHO');}), false);
  assert.equal(await run(async () => 1), false);
  assert.equal(await run(async () => ({claimed: true})), false);
});

// prettier-ignore
test('valid arm spent during slow consume cannot be used after expiration', async () => {
  let clock = NOW;
  const ledger = atomicMock();
  const slow = async (binding) => {
    const result = await ledger(binding);
    clock = NOW + 10001;
    return result;
  };
  assert.equal(await run(slow, {now: () => clock}), false);
  clock = NOW;
  assert.equal(await run(ledger, {now: () => clock}), false);
});

// prettier-ignore
test('clock rollback, stale receipt and other controller key fail closed', async () => {
  const ledger = atomicMock();
  let calls = 0;
  const rollback = async (binding) => {
    calls += 1;
    await ledger(binding);
    return true;
  };
  let count = 0;
  assert.equal(await run(rollback, {now: () => ++count === 1 ? NOW : NOW - 1}), false);
  assert.equal(calls, 1);
  assert.equal(await run(ledger, {now: () => NOW + 30000}), false);
  assert.equal(await run(ledger, {trustedControllerKeyId: 'attacker-key'}), false);
});
