// prettier-ignore
import assert from 'node:assert/strict';
// prettier-ignore
import test from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
// prettier-ignore
import { create020705AuthenticatedArmReaderCandidate, create020705RunnerArmChannelPorts } from '../.github/staging-ai-02-07-05/gatea-controller-arm-reader-candidate.mjs';
// prettier-ignore
import { create020705DurableAtomicClaimsCandidate } from '../.github/staging-ai-02-07-05/gatea-controller-atomic-claims-candidate.mjs';

// prettier-ignore
import { create020705TrustedControllerBootstrapCandidate } from '../.github/staging-ai-02-07-05/gatea-controller-trusted-bootstrap-candidate.mjs';

// prettier-ignore
const scope = Object.freeze({
  repository: 'bingohooah888-ai/novelrise',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
  mainSha: 'a'.repeat(40),
  previewDeploymentId: 'dpl_fixture123',
  actorId: '11111111-1111-4111-8111-111111111111',
  novelId: 998892071,
  episodeId: 998892072,
  runId: 700,
  approvalCommentId: 601
});
// prettier-ignore
const NONCE = 'N'.repeat(44);

// prettier-ignore
test('ARM reader does not trust unverified identity metadata or release a receipt', async () => {
  let reads = 0;
  let claims = 0;
  const reader = create020705AuthenticatedArmReaderCandidate({
    readControllerIdentity: async () => ({
      protectedEnvironment: 'staging',
      controllerKind: 'external-independent-supervisor',
      separateFromRunner: true, controllerRunId: 701, scope
    }),
    verifyControllerIdentityAttestation: async () => false,
    readAuthenticatedArm: async () => { reads += 1; return {}; },
    claimArmReceiptOnce: async () => { claims += 1; return true; },
    trustedControllerPublicKey: 'untrusted-local-fixture-key',
    trustedControllerKeyId: 'independent-gatea-01',
    expectedChallengeNonce: NONCE
  });
  assert.equal(await reader.verifyIndependentController(scope), false);
  await assert.rejects(reader.readIndependentWatchdogArm(scope),
    /AI_020705_ARM_READER_NO_GO/u);
  assert.equal(reads, 0);
  assert.equal(claims, 0);
});

// prettier-ignore
test('ARM reader denies absent authenticated ports at construction', () => {
  assert.throws(() => create020705AuthenticatedArmReaderCandidate({}),
    /AI_020705_ARM_READER_NO_GO/u);
});

// prettier-ignore
test('SQLite DO claim is one use for a run even with a different nonce', () => {
  const keys = new Set();
  let statements = 0;
  const storage = {
    transactionSync: (callback) => callback(),
    sql: {
      exec(statement, kind, key) {
        statements += 1;
        if (statement.startsWith('CREATE TABLE')) return { rowsWritten: 0 };
        if (!statement.startsWith('INSERT OR IGNORE')) throw new Error('SQL');
        const compound = JSON.stringify([kind, key]);
        if (keys.has(compound)) return { rowsWritten: 0 };
        keys.add(compound);
        return { rowsWritten: 1 };
      }
    }
  };
  const ledger = create020705DurableAtomicClaimsCandidate({
    storage, scope, controllerRunId: 701
  });
  assert.equal(ledger.claimOnce({
    kind: 'ARM', scope, nonce: NONCE, controllerRunId: 701
  }), true);
  assert.equal(ledger.claimOnce({
    kind: 'ARM', scope, nonce: 'M'.repeat(44), controllerRunId: 701
  }), false);
  assert.equal(ledger.claimOnce({
    kind: 'RECOVERY', scope, nonce: NONCE, controllerRunId: 701
  }), true);
  assert.equal(keys.size, 2);
  const prior = statements;
  assert.equal(ledger.claimOnce({
    kind: 'RECOVERY', scope: { ...scope, stagingProjectRef: 'production' },
    nonce: NONCE, controllerRunId: 701
  }), false);
  assert.equal(statements, prior);
});

// prettier-ignore
test('atomic claim cannot succeed on missing storage or ambiguous SQL result', () => {
  assert.throws(() => create020705DurableAtomicClaimsCandidate({
    scope, controllerRunId: 701
  }), /AI_020705_ATOMIC_CLAIM_NO_GO/u);
  const ledger = create020705DurableAtomicClaimsCandidate({
    storage: { transactionSync: (fn) => fn(), sql: { exec: () => ({}) } },
    scope, controllerRunId: 701
  });
  assert.equal(ledger.claimOnce({
    kind: 'ARM', scope, nonce: NONCE, controllerRunId: 701
  }), false);
});

// prettier-ignore
test('trusted Controller bootstrap rejects missing independently attested ports', () => {
  assert.throws(() => create020705TrustedControllerBootstrapCandidate({}),
    /AI_020705_CONTROLLER_BOOTSTRAP_NO_GO/u);
});

// prettier-ignore
test('one exact signed ARM is inspected, delivered and durably consumed once', async () => {
  const keys = generateKeyPairSync('ed25519');
  const candidate = Object.freeze({...scope, candidateSha: 'b'.repeat(40),
    stagingBranch: 'staging/ai-02-07-05-offline', capMicros: 1000000});
  const keyId = 'independent-gatea-01';
  const domain = 'NOVELIGHT_AI_020705_WATCHDOG_ARM_V1';
  let now = 1700000000000;
  let reads = 0;
  let claims = 0;
  const reader = create020705AuthenticatedArmReaderCandidate({
    readControllerIdentity: async (input) => ({
      protectedEnvironment: 'staging',
      controllerKind: 'external-independent-supervisor',
      separateFromRunner: true, controllerRunId: 701, scope: input
    }),
    verifyControllerIdentityAttestation: async () => true,
    async readAuthenticatedArm(input, args) {
      reads++;
      assert.equal(args.controllerRunId, 701);
      assert.equal(args.scope.candidateSha, candidate.candidateSha);
      assert.equal(args.nonce, NONCE);
      const receipt = {...input, kind: 'independent-controller-armed',
        protectedEnvironment: 'staging',
        controllerKind: 'external-independent-supervisor',
        controllerRunId: 701, controllerIsRunner: false,
        killAuthorityVerified: true, stagingDisableVerified: true,
        sessionRevocationVerified: true, syntheticCleanupVerified: true,
        zeroCensusVerified: true, noPaidRetry: true,
        observedAtMs: now, heartbeatAtMs: now, expiresAtMs: now + 15000};
      return {domain, keyId, challengeNonce: NONCE, receipt,
        signature: sign(null, Buffer.from(JSON.stringify([
          domain, keyId, NONCE, receipt
        ])), keys.privateKey).toString('base64url')};
    },
    async claimArmReceiptOnce(claim) {
      claims++;
      assert.deepEqual(claim.scope, scope);
      assert.equal(claim.contract, 'NOVELIGHT_AI_020705_ARM_RECEIPT_ONE_USE_V1');
      assert.equal(claim.controllerRunId, 701);
      return true;
    },
    trustedControllerPublicKey: keys.publicKey,
    trustedControllerKeyId: keyId, expectedChallengeNonce: NONCE,
    now: () => now
  });
  assert.equal(await reader.verifyIndependentController(candidate), true);
  const prepared = await reader.inspectIndependentWatchdogArm(candidate);
  assert.equal(await reader.verifyIndependentController(candidate), true);
  assert.equal(await reader.inspectIndependentWatchdogArm(candidate), prepared);
  assert.equal(reads, 1);
  assert.equal(claims, 0);
  await assert.rejects(reader.readIndependentWatchdogArm({
    ...candidate, capMicros: 999999
  }), /ARM_READER_NO_GO/u);
  assert.equal(await reader.readIndependentWatchdogArm(candidate), prepared);
  await assert.rejects(reader.readIndependentWatchdogArm(candidate),
    /ARM_READER_NO_GO/u);
  const challenge = {...candidate,
    contract: 'NOVELIGHT_AI_020705_WATCHDOG_ONE_USE_V1',
    controllerKeyId: keyId, nonce: NONCE};
  assert.equal(await reader.consumeWatchdogChallengeOnce(challenge), true);
  assert.equal(await reader.consumeWatchdogChallengeOnce(challenge), false);
  assert.equal(claims, 1);
  now += 15001;
  await assert.rejects(reader.inspectIndependentWatchdogArm(candidate),
    /ARM_READER_NO_GO/u);
});

// prettier-ignore
test('Runner private channel receives full signed scope and never the DO secret', async () => {
  const candidate = {...scope, candidateSha: 'b'.repeat(40),
    stagingBranch: 'staging/ai-02-07-05-offline', capMicros: 1000000};
  const envelope = {receipt: {controllerRunId: 701},
    keyId: 'independent-gatea-01', challengeNonce: NONCE};
  const history = [];
  const ports = create020705RunnerArmChannelPorts({
    scope: {...candidate, ignoredMetadata: 'not transmitted'},
    armChannel: {
      async issueArmReceipt(args) {history.push(args); return envelope;},
      async consumeArmReceipt(args) {history.push(args); return true;}
    }
  });
  const args = {scope: candidate, nonce: NONCE,
    keyId: envelope.keyId, controllerRunId: 701};
  assert.equal(await ports.readAuthenticatedArm(candidate, args), envelope);
  const claim = {scope, contract: 'NOVELIGHT_AI_020705_ARM_RECEIPT_ONE_USE_V1',
    nonce: NONCE, controllerKeyId: envelope.keyId, controllerRunId: 701};
  assert.equal(await ports.claimArmReceiptOnce(claim, envelope), true);
  assert.deepEqual(history[1], {scope: candidate, envelope});
  assert.equal(await ports.claimArmReceiptOnce({...claim, nonce: 'M'.repeat(44)},
    envelope), false);
  assert.equal(history.length, 2);
  assert.throws(() => create020705RunnerArmChannelPorts({scope: candidate}),
    /ARM_READER_NO_GO/u);
});
