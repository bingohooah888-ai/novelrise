import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
// prettier-ignore
import { verify020705SignedWatchdogArm } from
  '../.github/staging-ai-02-07-05/signed-watchdog-arm.mjs';

const NOW = Date.parse('2026-11-01T08:00:00Z');
const DOMAIN = 'NOVELIGHT_AI_020705_WATCHDOG_ARM_V1';
const NONCE = 'A'.repeat(44);
const KEY_ID = 'synthetic-controller-key-01';
// prettier-ignore
const scope = Object.freeze({
  repository: 'bingohooah888-ai/novelrise',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
  mainSha: 'a'.repeat(40),
  previewDeploymentId: 'dpl_synthetic123',
  actorId: '11111111-1111-4111-8111-111111111111',
  runId: 1001, approvalCommentId: 777, novelId: 41, episodeId: 11
});
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const attacker = generateKeyPairSync('ed25519');

// prettier-ignore
function receipt() {
  return {
    ...scope,
    kind: 'independent-controller-armed',
    protectedEnvironment: 'staging',
    controllerKind: 'external-independent-supervisor',
    controllerRunId: 3001, controllerIsRunner: false,
    killAuthorityVerified: true, stagingDisableVerified: true,
    sessionRevocationVerified: true, syntheticCleanupVerified: true,
    zeroCensusVerified: true, noPaidRetry: true,
    observedAtMs: NOW, heartbeatAtMs: NOW - 1000,
    expiresAtMs: NOW + 10000
  };
}
// prettier-ignore
function signed(r = receipt(), nonce = NONCE, key = privateKey) {
  const signature = sign(null, Buffer.from(JSON.stringify([
    DOMAIN, KEY_ID, nonce, r
  ]), 'utf8'), key).toString('base64url');
  return {domain: DOMAIN, keyId: KEY_ID, challengeNonce: nonce, receipt: r, signature};
}
// prettier-ignore
function check(envelope, changes = {}) {
  return verify020705SignedWatchdogArm({
    scope, envelope, trustedControllerPublicKey: publicKey,
    trustedControllerKeyId: KEY_ID, expectedChallengeNonce: NONCE,
    now: () => NOW, ...changes
  });
}

// prettier-ignore
test('trusted Ed25519 receipt and exact challenge validate offline', () => {
  assert.equal(check(signed()), true);
});
// prettier-ignore
test('forged signer, untrusted key, and wrong nonce fail closed', () => {
  assert.equal(check(signed(receipt(), NONCE, attacker.privateKey)), false);
  assert.equal(check(signed(), {trustedControllerPublicKey: attacker.publicKey}), false);
  assert.equal(check(signed(), {expectedChallengeNonce: 'B'.repeat(44)}), false);
  assert.equal(check(signed(receipt(), 'B'.repeat(44))), false);
  assert.equal(check(signed(), {trustedControllerKeyId: 'other-controller-key'}), false);
});
// prettier-ignore
test('scope and capability tampering and malformed envelopes deny', () => {
  const original = signed();
  assert.equal(check({...original, receipt: {...original.receipt, killAuthorityVerified: false}}), false);
  assert.equal(check({...original, receipt: {...original.receipt, mainSha: 'b'.repeat(40)}}), false);
  assert.equal(check({...original, domain: 'WRONG_DOMAIN'}), false);
  assert.equal(check({...original, extra: true}), false);
  assert.equal(check({...original, signature: 'invalid'}), false);
});
// prettier-ignore
test('stale and future signed receipts deny despite a valid signature', () => {
  assert.equal(check(signed(), {now: () => NOW + 30000}), false);
  assert.equal(check(signed(), {now: () => NOW - 1000}), false);
});
// prettier-ignore
test('missing trust input, malformed key, and missing receipt deny', () => {
  assert.equal(check(signed(), {trustedControllerPublicKey: undefined}), false);
  assert.equal(check(signed(), {trustedControllerPublicKey: 'NOT_A_PUBLIC_KEY'}), false);
  assert.equal(check(null), false);
  assert.equal(check({...signed(), receipt: null}), false);
});
