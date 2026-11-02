import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
// prettier-ignore
import { plan020705BoundedRecoveryLeaseOffline } from
  '../.github/staging-ai-02-07-05/recovery-lease-plan-offline.mjs';

const NOW = Date.parse('2026-11-02T00:00:00Z');
const DOMAIN = 'NOVELIGHT_AI_020705_DETACHED_DEATH_V1';
const KEY_ID = 'synthetic-controller-0001';
const NONCE = 'A'.repeat(44);
const NEW_NONCE = 'B'.repeat(44);
const KEYS = generateKeyPairSync('ed25519');
// prettier-ignore
const scope = Object.freeze({
  repository: 'bingohooah888-ai/novelrise',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
  mainSha: 'a'.repeat(40),
  previewDeploymentId: 'dpl_synthetic123',
  actorId: '11111111-1111-4111-8111-111111111111',
  novelId: 41, episodeId: 11, runId: 1001, approvalCommentId: 777
});

// prettier-ignore
function signed(proof, privateKey = KEYS.privateKey, nonce = NONCE) {
  const signature = sign(null, Buffer.from(JSON.stringify([
    DOMAIN, KEY_ID, nonce, proof
  ]), 'utf8'), privateKey).toString('base64url');
  return {
    domain: DOMAIN, keyId: KEY_ID,
    challengeNonce: nonce, proof, signature
  };
}

// prettier-ignore
function make({rounds = [], paidOneShotSpent = true, paidRetryCount = 0,
  activeRecoveryLease = false} = {}) {
  const proof = {
    ...scope,
    kind: 'detached-controller-runner-death',
    runnerConfirmedDead: true, controllerIsRunner: false,
    controllerRunId: 3001,
    observedAtMs: NOW - 10,
    runnerHeartbeatAtMs: NOW - 1000,
    expiresAtMs: NOW + 9000
  };
  const ledger = {
    ...scope,
    paidOneShotSpent, paidRetryCount, activeRecoveryLease,
    recoveryRounds: rounds, observedAtMs: NOW - 100
  };
  return {
    mode: 'offline-synthetic-only', scope, now: () => NOW,
    signedDeathEnvelope: signed(proof),
    trustedControllerPublicKey: KEYS.publicKey,
    trustedControllerKeyId: KEY_ID,
    expectedChallengeNonce: NONCE,
    nextRecoveryNonce: NEW_NONCE,
    trustedLedgerSnapshot: ledger
  };
}

// prettier-ignore
const completed = (round, state = 'failed') => ({
  round, fence: round,
  state, nonce: String.fromCharCode(67 + round).repeat(44),
  finishedAtMs: NOW - round * 100
});

// prettier-ignore
test('bounded recovery round 1 is advisory; paid model retry is always prohibited', () => {
  const result = plan020705BoundedRecoveryLeaseOffline(make());
  assert.equal(result.recoveryRound, 1);
  assert.equal(result.expectedNextFence, 1);
  assert.equal(result.authorizesMutation, false);
  assert.equal(result.authorizesPaidCall, false);
  assert.ok(result.proposedActions.includes('REVOKE_EXACT_SYNTHETIC_SESSIONS'));
  assert.ok(result.proposedActions.includes('READ_INDEPENDENT_ZERO_CENSUS'));
});

// prettier-ignore
test('failed recovery permits at most two additional advisory rounds, never a paid retry', () => {
  const once = plan020705BoundedRecoveryLeaseOffline(
    make({rounds: [completed(1)]})
  );
  assert.equal(once.recoveryRound, 2);
  assert.equal(once.expectedNextFence, 2);
  const twice = plan020705BoundedRecoveryLeaseOffline(
    make({rounds: [completed(1), completed(2)]})
  );
  assert.equal(twice.recoveryRound, 3);
  assert.equal(twice.authorizesPaidCall, false);
  assert.throws(() => plan020705BoundedRecoveryLeaseOffline(
    make({rounds: [completed(1), completed(2), completed(3)]})
  ), /AI_020705_RECOVERY_LEASE_OFFLINE_DENIED/u);
});

// prettier-ignore
test('completed recovery cannot be reopened', () => {
  const result = plan020705BoundedRecoveryLeaseOffline(make({
    rounds: [completed(1, 'complete')]
  }));
  assert.equal(result.status, 'ALREADY_RECOVERED_ADVISORY');
  assert.deepEqual(result.proposedActions, []);
  assert.equal(result.authorizesMutation, false);
  assert.throws(() => plan020705BoundedRecoveryLeaseOffline(make({
    rounds: [completed(1, 'complete'), completed(2)]
  })), /AI_020705_RECOVERY_LEASE_OFFLINE_DENIED/u);
});

// prettier-ignore
test('active lease, uncertain history or retried paid POST denies even advisory', () => {
  const cases = [
    {activeRecoveryLease: true},
    {paidOneShotSpent: false},
    {paidRetryCount: 1},
    {rounds: [{...completed(1), fence: 7}]},
    {rounds: [{...completed(1), state: 'in_progress'}]},
    {rounds: [completed(1), {...completed(2), nonce: completed(1).nonce}]}
  ];
  for (const values of cases) {
    assert.throws(() => plan020705BoundedRecoveryLeaseOffline(make(values)),
      /AI_020705_RECOVERY_LEASE_OFFLINE_DENIED/u);
  }
});

// prettier-ignore
test('forged, stale, wrong-scope or wrong-challenge death proof denies before planning', () => {
  const attacker = generateKeyPairSync('ed25519');
  const base = make();
  const cases = [
    {...base, signedDeathEnvelope: signed(base.signedDeathEnvelope.proof, attacker.privateKey)},
    {...base, expectedChallengeNonce: 'X'.repeat(44)},
    {...base, signedDeathEnvelope: signed({...base.signedDeathEnvelope.proof,
      mainSha: 'b'.repeat(40)})},
    {...base, signedDeathEnvelope: signed({...base.signedDeathEnvelope.proof,
      observedAtMs: NOW - 16000})},
    {...base, nextRecoveryNonce: NONCE}
  ];
  for (const options of cases) {
    assert.throws(() => plan020705BoundedRecoveryLeaseOffline(options),
      /AI_020705_RECOVERY_LEASE_OFFLINE_DENIED/u);
  }
});

// prettier-ignore
test('stale or overlapping ledger and duplicate recovery nonce cannot authorize planning', () => {
  const base = make();
  const cases = [
    {...base, trustedLedgerSnapshot: {...base.trustedLedgerSnapshot,
      observedAtMs: NOW - 16000}},
    {...base, trustedLedgerSnapshot: {...base.trustedLedgerSnapshot,
      mainSha: 'b'.repeat(40)}},
    make({rounds: [{...completed(1), nonce: NEW_NONCE}]})
  ];
  for (const options of cases) {
    assert.throws(() => plan020705BoundedRecoveryLeaseOffline(options),
      /AI_020705_RECOVERY_LEASE_OFFLINE_DENIED/u);
  }
});
