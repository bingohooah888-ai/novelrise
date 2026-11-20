// prettier-ignore
import assert from 'node:assert/strict';
// prettier-ignore
import test from 'node:test';
// prettier-ignore
import { create020705AuthenticatedArmReaderCandidate } from '../.github/staging-ai-02-07-05/gatea-controller-arm-reader-candidate.mjs';
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
