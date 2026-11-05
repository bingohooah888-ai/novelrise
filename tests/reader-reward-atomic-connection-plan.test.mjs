import assert from 'node:assert/strict';
import test from 'node:test';
import {
  auditScoutPointConnectionSurface,
  quoteScoutPointAtomicConnection,
  quoteScoutPointRecovery
} from '../api/_lib/reader-reward/atomic-connection-plan.js';
import {
  quoteScoutPointOperation,
  recheckScoutPointOperation
} from '../api/_lib/reader-reward/point-settlement.js';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OP2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const wallet = (overrides = {}) => ({
  userId: USER,
  availablePoints: 50000,
  reservedPoints: 0,
  revision: 9,
  ...overrides
});
const budget = (overrides = {}) => ({
  scopeId: 'test-budget-only-not-owner-approved',
  limitPoints: 100000,
  committedPoints: 0,
  reservedPoints: 0,
  revision: 2,
  ...overrides
});
const operation = (overrides = {}) => ({
  userId: USER,
  operationId: OP,
  purpose: 'external_exchange',
  amountPoints: 30000,
  phase: 'new',
  revision: 0,
  ...overrides
});
const proof = (overrides = {}) => ({
  authoritativeStateVerified: true,
  budgetPolicyApproved: true,
  pointEligibilityVerified: true,
  riskAndControlsCleared: true,
  operationUniquenessVerified: true,
  channelPolicyApproved: true,
  aiPriceApproved: true,
  fulfillmentVerified: true,
  failureOrCancellationVerified: true,
  noFulfillmentVerified: true,
  refundProofVerified: true,
  originalSettlementVerified: true,
  externalFundsRecoveryVerified: true,
  ...overrides
});
const guards = (overrides = {}) => ({
  trustedServerPrincipal: true,
  fullLedgerReconciliation: true,
  pointEligibilityPolicyApproved: true,
  identityAndRiskCleared: true,
  budgetPolicyApproved: true,
  singleTransactionGuaranteed: true,
  sharedWalletLockAndCas: true,
  budgetLockAndCas: true,
  durableOperationClaimUnique: true,
  operationRevisionCas: true,
  eventKeyUniqueAndReversalSafe: true,
  atomicAuditAndOutbox: true,
  legacyPointPathsSerialized: true,
  ...overrides
});
const quote = (action, overrides = {}) =>
  quoteScoutPointOperation({
    action,
    walletSnapshot: wallet(),
    budgetSnapshot: budget(),
    operationSnapshot: operation(),
    evidence: proof(),
    ...overrides
  });
const checked = (plan, overrides = {}) =>
  recheckScoutPointOperation({
    proposal: plan,
    currentWalletSnapshot: plan.expectedWallet,
    currentBudgetSnapshot: plan.expectedBudget,
    currentOperationSnapshot: plan.expectedOperation,
    duplicateOperationClaimVerified: true,
    duplicateOperationClaimExists: plan.action !== 'reserve',
    ...overrides
  });
const plan = (proposal, overrides = {}) =>
  quoteScoutPointAtomicConnection({
    proposal,
    recheck: checked(proposal),
    safeguards: guards(),
    ...overrides
  });
const metadata = (overrides = {}) => ({
  tables: {
    scout_point_ledger: {
      columns: [
        'id',
        'user_id',
        'point_kind',
        'point_value',
        'status',
        'event_key',
        'reversal_of',
        'occurred_at'
      ],
      rlsEnabled: true
    },
    scout_point_user_controls: {
      columns: ['user_id', 'earning_suspended_until', 'reason'],
      rlsEnabled: true
    },
    scout_point_operator_actions: {
      columns: ['id', 'user_id', 'ledger_id', 'action', 'created_at'],
      rlsEnabled: true
    }
  },
  uniqueKeys: [{ tableName: 'scout_point_ledger', columns: ['event_key'] }],
  ...overrides
});
const observed = (overrides = {}) => ({
  outcome: 'unknown',
  ...overrides
});
const recoveryProof = (overrides = {}) => ({
  authoritativeOperationSnapshot: true,
  ownerAndProviderIdentityVerified: true,
  originalClaimVerified: true,
  notificationHistoryComplete: true,
  duplicateNotification: false,
  fulfillmentReceiptVerified: true,
  noFulfillmentProofVerified: true,
  reversalProofVerified: true,
  externalFundsRecovered: true,
  ...overrides
});
const recovery = (phase, outcome, overrides = {}) =>
  quoteScoutPointRecovery({
    operation: operation({ phase }),
    observation: observed({ outcome }),
    evidence: recoveryProof(),
    ...overrides
  });

test('existing ledger and RLS can be reused only as partial building blocks', () => {
  const result = auditScoutPointConnectionSurface(metadata());
  assert.equal(result.status, 'preconnection_audit_only');
  assert.equal(result.reusable.existingEventKeyUnique, true);
  assert.equal(result.reusable.pointRls, true);
  assert.equal(result.reusable.reversalReference, true);
  assert.equal(result.mayConnectDb, false);
  assert.ok(result.blockers.includes('shared_wallet_revision_cas_not_proven'));
  assert.ok(
    result.blockers.includes('spending_freeze_and_identity_policy_not_proven')
  );
  assert.ok(result.blockers.includes('one_reversal_per_original_unverified'));
  assert.equal(Object.isFrozen(result.blockers), true);
});

test('RLS, unique key and real columns are required even for schema audit', () => {
  const initial = metadata();
  const missing = auditScoutPointConnectionSurface({
    ...initial,
    tables: {
      ...initial.tables,
      scout_point_ledger: { columns: ['id'], rlsEnabled: false }
    },
    uniqueKeys: []
  });
  assert.ok(missing.blockers.includes('missing_columns:scout_point_ledger'));
  assert.ok(missing.blockers.includes('rls_unverified:scout_point_ledger'));
  assert.ok(missing.blockers.includes('event_key_uniqueness_unverified'));
  assert.equal(missing.reusable.pointLedger, false);
  assert.throws(() => auditScoutPointConnectionSurface({}), TypeError);
});

test('even hypothetical extra reversal uniqueness does not authorize connection', () => {
  const result = auditScoutPointConnectionSurface(
    metadata({
      uniqueKeys: [
        { tableName: 'scout_point_ledger', columns: ['event_key'] },
        { tableName: 'scout_point_ledger', columns: ['reversal_of'] }
      ]
    })
  );
  assert.equal(result.mayConnectDb, false);
  assert.ok(
    result.blockers.includes('durable_operation_reservation_claim_not_proven')
  );
});

test('reserve outlines a transaction, not executable SQL or a payout', () => {
  const result = plan(quote('reserve'));
  assert.equal(result.status, 'connection_design_only');
  assert.equal(result.action, 'reserve');
  assert.ok(result.ledgerEventKey.endsWith(':reserve'));
  assert.equal(result.externalExecutionInsideTransaction, false);
  assert.equal(result.mayConnectDb, false);
  assert.equal(result.mayMovePointsOrMoney, false);
  assert.deepEqual(result.transactionSteps.slice(1, 3), [
    'lock_wallet_then_budget_then_operation_claim',
    'enforce_unique_operation_claim_and_event_key'
  ]);
});

test('commit and release require the verified original durable claim', () => {
  const reserved = quote('reserve');
  for (const action of ['commit', 'release']) {
    const next = quote(action, {
      walletSnapshot: reserved.nextWallet,
      budgetSnapshot: reserved.nextBudget,
      operationSnapshot: reserved.nextOperation
    });
    assert.equal(plan(next).status, 'connection_design_only');
    const missing = checked(next, {
      duplicateOperationClaimExists: false
    });
    assert.equal(
      plan(next, { recheck: missing }).status,
      'gate07_preconditions_not_proven'
    );
  }
});

test('refund uses a separate transaction and never restores budget implicitly', () => {
  const first = quote('reserve');
  const committed = quote('commit', {
    walletSnapshot: first.nextWallet,
    budgetSnapshot: first.nextBudget,
    operationSnapshot: first.nextOperation
  });
  const refunded = quote('refund', {
    walletSnapshot: committed.nextWallet,
    budgetSnapshot: committed.nextBudget,
    operationSnapshot: committed.nextOperation
  });
  assert.equal(refunded.nextBudget.revision, committed.nextBudget.revision);
  assert.equal(plan(refunded).status, 'connection_design_only');
  assert.ok(plan(refunded).ledgerEventKey.endsWith(':refund'));
});

test('any missing budget, risk, claim, or lock guard is fail-closed', () => {
  const proposal = quote('reserve');
  for (const name of Object.keys(guards())) {
    const result = plan(proposal, {
      safeguards: guards({ [name]: false })
    });
    assert.equal(result.status, 'atomic_safeguards_incomplete', name);
  }
  assert.equal(
    plan(proposal, { safeguards: undefined }).status,
    'atomic_safeguards_incomplete'
  );
});

test('stale wallet and budget prevent simultaneous AI and cash reservations', () => {
  const exchange = quote('reserve');
  const ai = quote('reserve', {
    operationSnapshot: operation({
      operationId: OP2,
      purpose: 'ai_direct_use',
      amountPoints: 25000
    })
  });
  assert.equal(plan(exchange).status, 'connection_design_only');
  const stale = checked(ai, {
    currentWalletSnapshot: exchange.nextWallet,
    currentBudgetSnapshot: exchange.nextBudget
  });
  assert.equal(stale.status, 'stale_snapshot');
  assert.equal(
    plan(ai, { recheck: stale }).status,
    'gate07_preconditions_not_proven'
  );
  assert.equal(
    quote('reserve', {
      walletSnapshot: exchange.nextWallet,
      budgetSnapshot: exchange.nextBudget,
      operationSnapshot: ai.expectedOperation
    }).status,
    'insufficient_eligible_points'
  );
});

test('a mismatched action or operation key cannot borrow another recheck', () => {
  const proposal = quote('reserve');
  assert.equal(
    plan(proposal, {
      recheck: { ...checked(proposal), action: 'refund' }
    }).status,
    'gate07_preconditions_not_proven'
  );
  assert.equal(
    plan(proposal, {
      recheck: { ...checked(proposal), operationKey: 'forged' }
    }).status,
    'gate07_preconditions_not_proven'
  );
});

test('timed-out or disconnected provider calls hold funds without retrying', () => {
  for (const outcome of ['unknown', 'pending']) {
    const result = recovery('reserved', outcome);
    assert.equal(result.status, 'hold_pending_authoritative_reconciliation');
    assert.equal(result.mayRetryExternal, false);
    assert.equal(result.mayMovePointsOrMoney, false);
  }
});

test('authoritative fulfillment can only propose a later commit', () => {
  assert.equal(
    recovery('reserved', 'fulfilled').status,
    'commit_candidate_only'
  );
  assert.equal(
    recovery('reserved', 'fulfilled', {
      evidence: recoveryProof({ fulfillmentReceiptVerified: false })
    }).status,
    'hold_pending_authoritative_reconciliation'
  );
});

test('confirmed no-delivery can only propose release, never cancel a paid order', () => {
  assert.equal(
    recovery('reserved', 'not_fulfilled').status,
    'release_candidate_only'
  );
  assert.equal(
    recovery('reserved', 'not_fulfilled', {
      evidence: recoveryProof({ noFulfillmentProofVerified: false })
    }).status,
    'hold_pending_authoritative_reconciliation'
  );
  assert.equal(
    recovery('reserved', 'fulfilled').status,
    'commit_candidate_only'
  );
});

test('duplicate callbacks require durable reconciliation, not double settlement', () => {
  for (const outcome of ['fulfilled', 'not_fulfilled']) {
    const result = recovery('reserved', outcome, {
      evidence: recoveryProof({ duplicateNotification: true })
    });
    assert.equal(result.status, 'duplicate_notification_reconcile');
    assert.equal(result.mayMovePointsOrMoney, false);
  }
});

test('partial fulfillment is neither automatic commit nor release', () => {
  assert.equal(
    recovery('reserved', 'partially_fulfilled').status,
    'partial_fulfillment_manual_reconcile'
  );
});

test('refunds require independently verified reversal and cash recovery', () => {
  assert.equal(
    recovery('committed', 'refunded').status,
    'refund_candidate_only'
  );
  for (const key of ['reversalProofVerified', 'externalFundsRecovered']) {
    assert.equal(
      recovery('committed', 'refunded', {
        evidence: recoveryProof({ [key]: false })
      }).status,
      'committed_no_automatic_refund'
    );
  }
  assert.equal(
    recovery('committed', 'fulfilled').status,
    'committed_no_automatic_refund'
  );
});

test('an AI refund needs reversal proof but not external cash recovery', () => {
  const result = recovery('committed', 'refunded', {
    operation: operation({
      purpose: 'ai_direct_use',
      phase: 'committed',
      amountPoints: 20
    }),
    evidence: recoveryProof({ externalFundsRecovered: false })
  });
  assert.equal(result.status, 'refund_candidate_only');
  assert.equal(result.mayRetryExternal, false);
});

test('terminal operations and missing claims never repeat effects', () => {
  assert.equal(recovery('released', 'fulfilled').status, 'terminal_noop');
  assert.equal(recovery('refunded', 'fulfilled').status, 'terminal_noop');
  assert.equal(recovery('new', 'fulfilled').status, 'missing_reservation_hold');
});

test('unverified owner, claim and event history block recovery', () => {
  for (const key of [
    'authoritativeOperationSnapshot',
    'ownerAndProviderIdentityVerified',
    'originalClaimVerified',
    'notificationHistoryComplete'
  ]) {
    assert.equal(
      recovery('reserved', 'fulfilled', {
        evidence: recoveryProof({ [key]: false })
      }).status,
      'recovery_evidence_incomplete',
      key
    );
  }
  assert.throws(
    () =>
      quoteScoutPointRecovery({
        operation: operation({ phase: 'invalid' }),
        observation: observed(),
        evidence: recoveryProof()
      }),
    TypeError
  );
});
