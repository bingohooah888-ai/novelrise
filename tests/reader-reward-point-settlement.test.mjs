import assert from 'node:assert/strict';
import test from 'node:test';
import {
  quoteScoutPointOperation,
  recheckScoutPointOperation,
  quoteScoutPointGrantBudget
} from '../api/_lib/reader-reward/point-settlement.js';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OP2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const wallet = (props = {}) => ({
  userId: USER, availablePoints: 5000, reservedPoints: 0, revision: 9, ...props
});
const budget = (props = {}) => ({
  scopeId: 'approved-period-identifier-test-only',
  limitPoints: 10000, committedPoints: 2000, reservedPoints: 0, revision: 3,
  ...props
});
const operation = (props = {}) => ({
  userId: USER, operationId: OP, purpose: 'external_exchange',
  amountPoints: 3000, phase: 'new', revision: 0, ...props
});
const evidence = (props = {}) => ({
  authoritativeStateVerified: true, budgetPolicyApproved: true,
  pointEligibilityVerified: true, riskAndControlsCleared: true,
  operationUniquenessVerified: true, channelPolicyApproved: true,
  aiPriceApproved: true, fulfillmentVerified: true,
  failureOrCancellationVerified: true, noFulfillmentVerified: true,
  refundProofVerified: true, originalSettlementVerified: true,
  externalFundsRecoveryVerified: true, ...props
});
const quote = (action, props = {}) => quoteScoutPointOperation({
  action, walletSnapshot: wallet(), budgetSnapshot: budget(),
  operationSnapshot: operation(), evidence: evidence(), ...props
});
const stage = (action, previous, props = {}) => quote(action, {
  walletSnapshot: previous.nextWallet,
  budgetSnapshot: previous.nextBudget,
  operationSnapshot: previous.nextOperation,
  ...props
});

test('reserve removes only available points and keeps reserved funds accounted', () => {
  const result = quote('reserve');
  assert.equal(result.status, 'proposal_only');
  assert.deepEqual(result.nextWallet, wallet({
    availablePoints: 2000, reservedPoints: 3000, revision: 10
  }));
  assert.deepEqual(result.nextBudget, budget({
    reservedPoints: 3000, revision: 4
  }));
  assert.equal(result.nextOperation.phase, 'reserved');
  assert.equal(result.nextOperation.revision, 1);
  assert.equal(result.mayMovePointsOrMoney, false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.nextWallet), true);
});

test('reserve -> commit spends once; committed period budget is not released', () => {
  const reserved = quote('reserve');
  const settled = stage('commit', reserved);
  assert.equal(settled.status, 'proposal_only');
  assert.deepEqual(settled.nextWallet, wallet({
    availablePoints: 2000, reservedPoints: 0, revision: 11
  }));
  assert.deepEqual(settled.nextBudget, budget({
    committedPoints: 5000, reservedPoints: 0, revision: 5
  }));
  assert.equal(settled.nextOperation.phase, 'committed');
  assert.equal(stage('commit', settled).status, 'invalid_phase');
  assert.equal(stage('release', settled).status, 'invalid_phase');
});

test('reservation cancellation releases amount exactly once without payment', () => {
  const reserved = quote('reserve');
  const released = stage('release', reserved);
  assert.equal(released.status, 'proposal_only');
  assert.deepEqual(released.nextWallet, wallet({
    availablePoints: 5000, reservedPoints: 0, revision: 11
  }));
  assert.deepEqual(released.nextBudget, budget({
    committedPoints: 2000, reservedPoints: 0, revision: 5
  }));
  assert.equal(released.nextOperation.phase, 'released');
  assert.equal(stage('release', released).status, 'invalid_phase');
  assert.equal(stage('commit', released).status, 'invalid_phase');
});

test('committed AI invocation may refund only with verified reversal evidence', () => {
  const reserved = quote('reserve', {
    operationSnapshot: operation({
      purpose: 'ai_direct_use', amountPoints: 20
    })
  });
  const committed = stage('commit', reserved);
  const refunded = stage('refund', committed);
  assert.equal(refunded.status, 'proposal_only');
  assert.equal(refunded.nextWallet.availablePoints, 5000);
  assert.equal(refunded.nextWallet.reservedPoints, 0);
  assert.equal(refunded.nextOperation.phase, 'refunded');
  // A refund restores wallet points, but does not automatically re-credit
  // an already committed period budget without an approved policy.
  assert.equal(refunded.nextBudget.committedPoints, committed.nextBudget.committedPoints);
  assert.equal(refunded.nextBudget.revision, committed.nextBudget.revision);
  assert.equal(stage('refund', refunded).status, 'invalid_phase');
});

test('external cashout refund cannot credit wallet until funds recovery verified', () => {
  const committed = stage('commit', quote('reserve'));
  const unproven = stage('refund', committed, {
    evidence: evidence({ externalFundsRecoveryVerified: false })
  });
  assert.equal(unproven.status, 'refund_proof_incomplete');
  assert.equal(Object.hasOwn(unproven, 'nextWallet'), false);
  const justified = stage('refund', committed);
  assert.equal(justified.status, 'proposal_only');
  assert.equal(justified.nextWallet.availablePoints, 5000);
  assert.equal(justified.nextBudget.committedPoints, 5000);
});

test('unverified fulfillment never commits, and unverified cancellation never releases', () => {
  const reserved = quote('reserve');
  assert.equal(stage('commit', reserved, {
    evidence: evidence({ fulfillmentVerified: false })
  }).status, 'fulfillment_not_verified');
  for (const proof of [
    evidence({ failureOrCancellationVerified: false }),
    evidence({ noFulfillmentVerified: false })
  ]) {
    assert.equal(stage('release', reserved, { evidence: proof }).status,
      'release_proof_incomplete');
  }
  const committed = stage('commit', reserved);
  assert.equal(stage('refund', committed, {
    evidence: evidence({ refundProofVerified: false })
  }).status, 'refund_proof_incomplete');
  assert.equal(stage('refund', committed, {
    evidence: evidence({ originalSettlementVerified: false })
  }).status, 'refund_proof_incomplete');
});

test('same operation cannot reserve twice, even before a durable claim exists', () => {
  const initial = quote('reserve');
  const repeated = stage('reserve', initial);
  assert.equal(repeated.status, 'invalid_phase');
  assert.equal(repeated.status === 'proposal_only', false);
  const pending = recheckScoutPointOperation({
    proposal: initial,
    currentWalletSnapshot: initial.expectedWallet,
    currentBudgetSnapshot: initial.expectedBudget,
    currentOperationSnapshot: initial.expectedOperation,
    duplicateOperationClaimVerified: true,
    duplicateOperationClaimExists: true
  });
  assert.equal(pending.status, 'already_reserved');
});

test('a verified wallet and budget CAS both must match before any commit', () => {
  const plan = quote('reserve');
  const valid = recheckScoutPointOperation({
    proposal: plan,
    currentWalletSnapshot: wallet(),
    currentBudgetSnapshot: budget(),
    currentOperationSnapshot: operation(),
    duplicateOperationClaimVerified: true,
    duplicateOperationClaimExists: false
  });
  assert.equal(valid.status, 'preconditions_match_only');
  assert.equal(valid.mayMovePointsOrMoney, false);
  const variations = [
    { currentWalletSnapshot: wallet({ revision: 10 }) },
    { currentWalletSnapshot: wallet({ availablePoints: 4900 }) },
    { currentBudgetSnapshot: budget({ revision: 4 }) },
    { currentBudgetSnapshot: budget({ reservedPoints: 1 }) },
    { currentOperationSnapshot: operation({ revision: 1 }) },
    { currentOperationSnapshot: operation({ amountPoints: 2999 }) },
    { currentOperationSnapshot: operation({ operationId: OP2 }) }
  ];
  for (const overrides of variations) {
    const result = recheckScoutPointOperation({
      proposal: plan, currentWalletSnapshot: wallet(),
      currentBudgetSnapshot: budget(), currentOperationSnapshot: operation(),
      duplicateOperationClaimVerified: true, duplicateOperationClaimExists: false,
      ...overrides
    });
    assert.equal(result.status, 'stale_snapshot');
  }
});

test('concurrent external redemption and AI use cannot both reuse old snapshot', () => {
  const exchange = quote('reserve');
  const ai = quote('reserve', {
    operationSnapshot: operation({
      operationId: OP2, purpose: 'ai_direct_use', amountPoints: 2500
    })
  });
  assert.equal(exchange.status, 'proposal_only');
  assert.equal(ai.status, 'proposal_only');
  const stale = recheckScoutPointOperation({
    proposal: ai,
    currentWalletSnapshot: exchange.nextWallet,
    currentBudgetSnapshot: exchange.nextBudget,
    currentOperationSnapshot: ai.expectedOperation,
    duplicateOperationClaimVerified: true,
    duplicateOperationClaimExists: false
  });
  assert.equal(stale.status, 'stale_snapshot');
  assert.equal(exchange.nextWallet.availablePoints, 2000);
  assert.equal(2500 > exchange.nextWallet.availablePoints, true);
});

test('unapproved budget and any risk or eligibility doubt block reservations', () => {
  for (const key of [
    'authoritativeStateVerified',
    'budgetPolicyApproved',
    'pointEligibilityVerified',
    'riskAndControlsCleared',
    'operationUniquenessVerified'
  ]) {
    const result = quote('reserve', { evidence: evidence({ [key]: false }) });
    assert.equal(result.status, 'evidence_or_budget_policy_incomplete');
    assert.equal(Object.hasOwn(result, 'nextWallet'), false);
  }
  assert.equal(quote('reserve', {
    evidence: evidence({ channelPolicyApproved: false })
  }).status, 'channel_policy_unapproved');
  assert.equal(quote('reserve', {
    operationSnapshot: operation({ purpose: 'ai_direct_use', amountPoints: 1 }),
    evidence: evidence({ aiPriceApproved: false })
  }).status, 'channel_policy_unapproved');
});

test('budget cap includes both committed costs and in-flight reservations', () => {
  assert.equal(quote('reserve', {
    budgetSnapshot: budget({
      limitPoints: 5000, committedPoints: 2000, reservedPoints: 2000
    })
  }).status, 'budget_exceeded');
  assert.equal(quote('reserve', {
    budgetSnapshot: budget({
      limitPoints: 5000, committedPoints: 2000, reservedPoints: 0
    })
  }).status, 'proposal_only');
  assert.equal(quote('reserve', {
    budgetSnapshot: budget({
      limitPoints: 4999, committedPoints: 2000, reservedPoints: 0
    })
  }).status, 'budget_exceeded');
});

test('external 3000 point minimum never applies to direct AI usage', () => {
  assert.equal(quote('reserve', {
    operationSnapshot: operation({ amountPoints: 2999 })
  }).status, 'below_exchange_minimum');
  for (const amount of [1, 10, 2999]) {
    const result = quote('reserve', {
      operationSnapshot: operation({
        purpose: 'ai_direct_use', amountPoints: amount
      })
    });
    assert.equal(result.status, 'proposal_only');
    assert.equal(result.nextWallet.availablePoints, 5000 - amount);
  }
});

test('insufficient points, mixed user and missing evidence fail closed', () => {
  assert.equal(quote('reserve', {
    walletSnapshot: wallet({ availablePoints: 2500 })
  }).status, 'insufficient_eligible_points');
  assert.equal(quote('reserve', {
    operationSnapshot: operation({ userId: OTHER })
  }).status, 'user_mismatch');
  assert.equal(quote('reserve', {
    evidence: undefined
  }).status, 'evidence_or_budget_policy_incomplete');
});

test('broken wallet, phase, budget and overflow snapshots never produce proposals', () => {
  for (const bad of [
    { walletSnapshot: wallet({ reservedPoints: -1 }) },
    { walletSnapshot: wallet({ revision: Number.MAX_SAFE_INTEGER }) },
    { walletSnapshot: wallet({ availablePoints: '5000' }) },
    { budgetSnapshot: budget({ limitPoints: -1 }) },
    { budgetSnapshot: budget({ limitPoints: 1 }) },
    { budgetSnapshot: budget({ scopeId: '' }) },
    { budgetSnapshot: budget({ committedPoints: Number.MAX_SAFE_INTEGER }) },
    { operationSnapshot: operation({ phase: 'invalid' }) },
    { operationSnapshot: operation({ amountPoints: -1 }) },
    { operationSnapshot: operation({ amountPoints: 0 }) },
    { operationSnapshot: operation({ revision: Number.MAX_SAFE_INTEGER }) },
    { operationSnapshot: operation({ operationId: 'not-a-uuid' }) }
  ]) {
    assert.throws(() => quote('reserve', bad));
  }
  assert.throws(() => quote('other'));
});

test('wallet transition cannot be rechecked without a unique claim observation', () => {
  const plan = quote('reserve');
  assert.equal(recheckScoutPointOperation({
    proposal: plan, currentWalletSnapshot: wallet(),
    currentBudgetSnapshot: budget(), currentOperationSnapshot: operation(),
    duplicateOperationClaimVerified: false,
    duplicateOperationClaimExists: false
  }).status, 'unique_claim_unverified');
  assert.throws(() => recheckScoutPointOperation({
    proposal: { status: 'invalid_phase' },
    currentWalletSnapshot: wallet(), currentBudgetSnapshot: budget(),
    currentOperationSnapshot: operation(), duplicateOperationClaimVerified: true,
    duplicateOperationClaimExists: false
  }), TypeError);
});

test('reward issuance has its own approved budget distinct from redemption', () => {
  const result = quoteScoutPointGrantBudget({
    pointsToIssue: 5,
    fundingBudgetSnapshot: budget({
      scopeId: 'issuance-budget-test-only',
      limitPoints: 1500, committedPoints: 1000, reservedPoints: 495
    }),
    fundingBudgetVerified: true,
    awardEventUniqueVerified: true,
    awardEventPreviouslyIssued: false
  });
  assert.equal(result.status, 'grant_budget_quote_only');
  assert.equal(result.proposedBudget.committedPoints, 1005);
  assert.equal(result.proposedBudget.revision, 4);
  assert.equal(result.mayIssuePoints, false);
  const tooMuch = quoteScoutPointGrantBudget({
    pointsToIssue: 6,
    fundingBudgetSnapshot: budget({
      scopeId: 'issuance-budget-test-only',
      limitPoints: 1500, committedPoints: 1000, reservedPoints: 495
    }),
    fundingBudgetVerified: true,
    awardEventUniqueVerified: true,
    awardEventPreviouslyIssued: false
  });
  assert.equal(tooMuch.status, 'funding_budget_exceeded');
});

test('missing issuance budget approval and previously issued level/badge refuse payout', () => {
  const normal = {
    pointsToIssue: 5, fundingBudgetSnapshot: budget(),
    fundingBudgetVerified: true, awardEventUniqueVerified: true,
    awardEventPreviouslyIssued: false
  };
  assert.equal(quoteScoutPointGrantBudget({
    ...normal, fundingBudgetVerified: false
  }).status, 'funding_evidence_incomplete');
  assert.equal(quoteScoutPointGrantBudget({
    ...normal, awardEventUniqueVerified: false
  }).status, 'funding_evidence_incomplete');
  assert.equal(quoteScoutPointGrantBudget({
    ...normal, awardEventPreviouslyIssued: true
  }).status, 'already_awarded');
});

test('refund does not restore a consumed period budget without owner approval', () => {
  const reserved = quote('reserve');
  const committed = stage('commit', reserved);
  const refunded = stage('refund', committed);
  assert.equal(refunded.nextBudget.committedPoints, committed.nextBudget.committedPoints);
  assert.equal(refunded.nextBudget.reservedPoints, committed.nextBudget.reservedPoints);
  assert.equal(refunded.nextBudget.revision, committed.nextBudget.revision);
});
