import assert from 'node:assert/strict';
import test from 'node:test';
import {
  quoteScoutReceiptConsistency,
  quoteScoutAtomicResourceContract
} from '../api/_lib/reader-reward/durable-reconciliation-contract.js';
import {
  quoteScoutPointOperation,
  recheckScoutPointOperation
} from '../api/_lib/reader-reward/point-settlement.js';
import {
  quoteScoutPointAtomicConnection,
  quoteScoutPointRecovery
} from '../api/_lib/reader-reward/atomic-connection-plan.js';
import { quoteScoutProviderOutboxEnqueue } from '../api/_lib/reader-reward/provider-outbox-simulation.js';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OP = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DIGEST = 'a'.repeat(64);
const BAD_DIGEST = 'b'.repeat(64);
const ROUTE = 'test_route';
const providerKey = 'scout-provider-v1:' + USER + ':' + OP;
const operationKey = 'scout-point-use-v1:' + USER + ':' + OP;
const wallet = () => ({
  userId: USER,
  availablePoints: 80000,
  reservedPoints: 0,
  revision: 5
});
const budget = () => ({
  scopeId: 'mock_budget_not_approved_in_live_service',
  limitPoints: 100000,
  committedPoints: 0,
  reservedPoints: 0,
  revision: 9
});
const operation = () => ({
  userId: USER,
  operationId: OP,
  purpose: 'external_exchange',
  amountPoints: 30000,
  phase: 'new',
  revision: 0
});
const grantEvidence = () => ({
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
  externalFundsRecoveryVerified: true
});
const gate08Guards = () => ({
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
  legacyPointPathsSerialized: true
});
const enqueueProof = () => ({
  serverIdentityVerified: true,
  reservationClaimAndLedgerVerified: true,
  atomicOutboxWithReservationVerified: true,
  authorizedBudgetAndPointEligibility: true,
  riskAndIdentityCleared: true,
  providerRouteAndIdempotencyContractVerified: true,
  immutablePayloadBoundToApprovedTerms: true,
  privateOutboxAndAuditVerified: true,
  aiPriceApproved: true
});
const reconciliationEvidence = (changes = {}) => ({
  serverPrincipalAuthenticated: true,
  claimOwnerAndPhaseVerified: true,
  receiptSignaturesAndSourceVerified: true,
  completeOrderedDurableReceiptHistoryVerified: true,
  authoritativeProviderQueryVerified: true,
  providerFinalityAndReversalPolicyVerified: true,
  providerQueryFreshnessVerified: true,
  outboxPayloadAndIdempotencyContractVerified: true,
  walletBudgetAndLedgerCasVerified: true,
  independentFulfillmentProofVerified: true,
  definitiveNonfulfillmentAndCancellationProven: true,
  ...changes
});
const atomicCapabilities = (changes = {}) => ({
  trustedServerOnlyPrincipal: true,
  authoritativeEligibleLedgerReconciled: true,
  betaPointAndSpendingPolicyApproved: true,
  identityFraudAndSpendingFreezeVerified: true,
  scopeBudgetApproved: true,
  singleSerializableDatabaseTransaction: true,
  globalWalletBudgetClaimLockOrder: true,
  walletRevisionCompareAndSwap: true,
  budgetRevisionCompareAndSwap: true,
  durableOperationClaimUnique: true,
  operationPhaseRevisionCompareAndSwap: true,
  uniquePhaseLedgerEvent: true,
  uniqueReversalOfOriginal: true,
  outboxUniquePerOperation: true,
  outboxPayloadImmutable: true,
  claimWalletBudgetLedgerOutboxAuditSameCommit: true,
  notificationJournalAndReceiptDedupDurable: true,
  providerIdempotencyAndStatusQueryContract: true,
  providerFinalityAndReversalPolicyVerified: true,
  legacyPointPathsSerialized: true,
  privilegedRpcAndRlsAudited: true,
  networkOnlyAfterDatabaseCommit: true,
  ...changes
});
function action(action, source) {
  const input = source ?? {
    nextWallet: wallet(),
    nextBudget: budget(),
    nextOperation: operation()
  };
  const proposal = quoteScoutPointOperation({
    action,
    walletSnapshot: input.nextWallet,
    budgetSnapshot: input.nextBudget,
    operationSnapshot: input.nextOperation,
    evidence: grantEvidence()
  });
  assert.equal(proposal.status, 'proposal_only', 'Gate07 ' + action);
  const recheck = recheckScoutPointOperation({
    proposal,
    currentWalletSnapshot: proposal.expectedWallet,
    currentBudgetSnapshot: proposal.expectedBudget,
    currentOperationSnapshot: proposal.expectedOperation,
    duplicateOperationClaimVerified: true,
    duplicateOperationClaimExists: action !== 'reserve'
  });
  assert.equal(recheck.status, 'preconditions_match_only');
  const gate08Design = quoteScoutPointAtomicConnection({
    proposal,
    recheck,
    safeguards: gate08Guards()
  });
  assert.equal(gate08Design.status, 'connection_design_only');
  return { proposal, recheck, gate08Design };
}
function setup() {
  const first = action('reserve');
  const outboxQuote = quoteScoutProviderOutboxEnqueue({
    reservedOperation: first.proposal.nextOperation,
    reservationDesign: first.gate08Design,
    payload: { providerRoute: ROUTE, payloadDigest: DIGEST },
    evidence: enqueueProof()
  });
  assert.equal(outboxQuote.status, 'outbox_enqueue_quote_only');
  return { first, outboxQuote, outbox: outboxQuote.nextOutbox };
}
function receipt(overrides = {}) {
  return {
    eventId: 'evt_01',
    outcome: 'succeeded',
    transactionId: 'provider_tx_01',
    operationKey,
    providerRoute: ROUTE,
    payloadDigest: DIGEST,
    providerIdempotencyKey: providerKey,
    ...overrides
  };
}
function provider(state = 'fulfilled', overrides = {}) {
  return {
    state,
    transactionId: state === 'not_fulfilled' ? null : 'provider_tx_01',
    operationKey,
    providerRoute: ROUTE,
    payloadDigest: DIGEST,
    providerIdempotencyKey: providerKey,
    ...overrides
  };
}
function reconcile(s, overrides = {}) {
  return quoteScoutReceiptConsistency({
    operation: s.first.proposal.nextOperation,
    outbox: s.outbox,
    receiptHistory: [receipt()],
    providerObservation: provider(),
    evidence: reconciliationEvidence(),
    ...overrides
  });
}
function snapshot(bundle, isReserve = false, overrides = {}) {
  const op = bundle.proposal.expectedOperation;
  return {
    operationKey: bundle.proposal.operationKey,
    phase: op.phase,
    operationRevision: op.revision,
    walletRevision: bundle.proposal.expectedWallet.revision,
    budgetRevision: bundle.proposal.expectedBudget.revision,
    budgetScope: bundle.proposal.expectedBudget.scopeId,
    userId: op.userId,
    providerIdempotencyKey: providerKey,
    outboxPayloadDigest: DIGEST,
    providerRoute: ROUTE,
    outboxOperationKey: isReserve ? null : operationKey,
    existingOutbox: !isReserve,
    ...overrides
  };
}
function contract(bundle, overrides = {}) {
  return quoteScoutAtomicResourceContract({
    ...bundle,
    snapshot: snapshot(bundle, bundle.proposal.action === 'reserve'),
    capabilities: atomicCapabilities(),
    ...overrides
  });
}
const noEffects = (v) => {
  assert.equal(v.mayConnectDb, false);
  assert.equal(v.mayInvokeProvider, false);
  assert.equal(v.mayMovePointsOrMoney, false);
  assert.equal(v.maySettle, false);
};

test('valid signed history and matching fresh fulfilled provider query yields only commit candidate', () => {
  const s = setup();
  const d = reconcile(s);
  assert.equal(d.status, 'commit_candidate_only');
  assert.equal(d.operationKey, operationKey);
  assert.equal(d.ledgerEventKey, operationKey + ':commit');
  assert.equal(d.payloadDigest, DIGEST);
  assert.equal(d.providerIdempotencyKey, providerKey);
  noEffects(d);
});

test('two different successful external transactions cannot be double-settled regardless of callback order', () => {
  const s = setup();
  const a = receipt();
  const b = receipt({ eventId: 'evt_02', transactionId: 'provider_tx_02' });
  for (const history of [
    [a, b],
    [b, a]
  ]) {
    const d = reconcile(s, { receiptHistory: history });
    assert.equal(d.status, 'different_provider_transaction_ids_manual_hold');
    assert.equal(d.distinctTransactionCount, 2);
    noEffects(d);
  }
});

test('provider transaction collision is detected even if one result remains pending', () => {
  const s = setup();
  const d = reconcile(s, {
    receiptHistory: [
      receipt({ outcome: 'pending', transactionId: 'provider_tx_02' }),
      receipt({ eventId: 'evt_02' })
    ]
  });
  assert.equal(d.status, 'different_provider_transaction_ids_manual_hold');
});

test('mixed success and definitive failure always holds regardless of callback order', () => {
  const s = setup();
  const events = [receipt(), receipt({ eventId: 'evt_02', outcome: 'failed' })];
  for (const receiptHistory of [events, [...events].reverse()]) {
    assert.equal(
      reconcile(s, { receiptHistory }).status,
      'success_failure_contradiction_manual_hold'
    );
  }
});

test('exact duplicate event ID and payload is one evidence record', () => {
  const s = setup();
  const result = reconcile(s, {
    receiptHistory: [receipt(), receipt()]
  });
  assert.equal(result.status, 'commit_candidate_only');
  noEffects(result);
});

test('event ID reused with changed outcome is a conflict hold', () => {
  const s = setup();
  const result = reconcile(s, {
    receiptHistory: [receipt(), receipt({ outcome: 'pending' })]
  });
  assert.equal(result.status, 'event_id_collision_hold');
});

test('cross-operation, route, digest, and idempotency binding changes fail closed', () => {
  const s = setup();
  for (const changes of [
    { operationKey: 'another_operation' },
    { providerRoute: 'wrong_route' },
    { payloadDigest: BAD_DIGEST },
    { providerIdempotencyKey: 'someone_else' }
  ]) {
    assert.equal(
      reconcile(s, { receiptHistory: [receipt(changes)] }).status,
      'receipt_scope_or_payload_mismatch_hold'
    );
  }
});

test('forged provider observation cannot supply success evidence', () => {
  const s = setup();
  for (const changes of [
    { operationKey: 'not_my_operation' },
    { providerRoute: 'forged_route' },
    { payloadDigest: BAD_DIGEST },
    { providerIdempotencyKey: 'wrong' }
  ]) {
    assert.equal(
      reconcile(s, {
        providerObservation: provider('fulfilled', changes)
      }).status,
      'provider_observation_unbound_hold'
    );
  }
});

test('all expected source, signature, history, freshness, ledger CAS checks are required', () => {
  const s = setup();
  for (const name of Object.keys(reconciliationEvidence())) {
    const result = reconcile(s, {
      evidence: reconciliationEvidence({ [name]: false })
    });
    if (name === 'independentFulfillmentProofVerified') {
      assert.equal(result.status, 'fulfillment_evidence_incomplete_hold');
    } else if (name === 'definitiveNonfulfillmentAndCancellationProven') {
      assert.equal(result.status, 'commit_candidate_only');
    } else {
      assert.equal(result.status, 'reconciliation_evidence_missing', name);
    }
  }
});

test('provider pending and unknown outcomes never produce settle candidates', () => {
  const s = setup();
  for (const state of ['unknown', 'pending']) {
    const result = reconcile(s, { providerObservation: provider(state) });
    assert.equal(result.status, 'unknown_fulfillment_hold');
    noEffects(result);
  }
});

test('partial observed in any receipt or provider query holds for manual review', () => {
  const s = setup();
  assert.equal(
    reconcile(s, {
      receiptHistory: [receipt({ outcome: 'partial' })]
    }).status,
    'partial_fulfillment_manual_hold'
  );
  assert.equal(
    reconcile(s, { providerObservation: provider('partial') }).status,
    'partial_fulfillment_manual_hold'
  );
});

test('claimed success with authoritative no-fulfillment must not commit or release', () => {
  const s = setup();
  assert.equal(
    reconcile(s, {
      providerObservation: provider('not_fulfilled')
    }).status,
    'provider_and_receipts_disagree_hold'
  );
});

test('claimed failure with authoritative fulfilled must not settle', () => {
  const s = setup();
  assert.equal(
    reconcile(s, {
      receiptHistory: [receipt({ outcome: 'failed' })]
    }).status,
    'provider_and_receipts_disagree_hold'
  );
});

test('authoritative success without a matching provider transaction ID stays on hold', () => {
  const s = setup();
  assert.equal(
    reconcile(s, {
      providerObservation: provider('fulfilled', {
        transactionId: 'another_tx'
      })
    }).status,
    'fulfillment_evidence_incomplete_hold'
  );
});

test('an authoritative query alone cannot silently replace missing receipt history', () => {
  const s = setup();
  assert.equal(
    reconcile(s, { receiptHistory: [] }).status,
    'unknown_fulfillment_hold'
  );
});

test('confirmed failed receipt plus definitive no-fulfillment proof yields release candidate only', () => {
  const s = setup();
  const result = reconcile(s, {
    receiptHistory: [receipt({ outcome: 'failed', transactionId: null })],
    providerObservation: provider('not_fulfilled')
  });
  assert.equal(result.status, 'release_candidate_only');
  assert.equal(result.ledgerEventKey, operationKey + ':release');
  noEffects(result);
});

test('missing independent definitive non-fulfillment proof bars a release', () => {
  const s = setup();
  assert.equal(
    reconcile(s, {
      receiptHistory: [receipt({ outcome: 'failed', transactionId: null })],
      providerObservation: provider('not_fulfilled'),
      evidence: reconciliationEvidence({
        definitiveNonfulfillmentAndCancellationProven: false
      })
    }).status,
    'nonfulfillment_evidence_incomplete_hold'
  );
});

test('a terminal operation cannot settle twice, even with a new callback', () => {
  const s = setup();
  for (const phase of ['committed', 'released', 'refunded']) {
    const r = reconcile(s, {
      operation: { ...s.first.proposal.nextOperation, phase }
    });
    assert.equal(
      r.status,
      phase === 'committed'
        ? 'committed_operation_noop'
        : 'terminal_operation_noop'
    );
  }
});

test('an operation without a locked original reservation is held', () => {
  const s = setup();
  assert.equal(
    reconcile(s, {
      operation: { ...s.first.proposal.nextOperation, phase: 'new' }
    }).status,
    'no_durable_reservation_hold'
  );
});

test('invalid receipt or a bounded history overflow cannot become commit', () => {
  const s = setup();
  assert.equal(
    reconcile(s, {
      receiptHistory: [{ ...receipt(), eventId: '!!!' }]
    }).status,
    'invalid_receipt_hold'
  );
  assert.equal(
    reconcile(s, {
      receiptHistory: Array.from({ length: 101 }, (_, i) =>
        receipt({ eventId: 'evt_' + i })
      )
    }).status,
    'history_capacity_hold'
  );
});

test('two compatible pending and success notifications can reconcile to one candidate', () => {
  const s = setup();
  const r = reconcile(s, {
    receiptHistory: [
      receipt({ outcome: 'pending' }),
      receipt({ eventId: 'evt_02' })
    ]
  });
  assert.equal(r.status, 'commit_candidate_only');
});

test('reserve contract integrates existing Gate07, Gate08 and Gate09 quotes', () => {
  const s = setup();
  const r = contract(s.first, { outboxQuote: s.outboxQuote });
  assert.equal(r.status, 'atomic_contract_design_only');
  assert.equal(r.action, 'reserve');
  assert.equal(r.ledgerEventKey, operationKey + ':reserve');
  noEffects(r);
});

test('global lock order, compare-and-swap and before-network commit are explicit requirements', () => {
  const s = setup();
  const r = contract(s.first, { outboxQuote: s.outboxQuote });
  assert.equal(r.status, 'atomic_contract_design_only');
  assert.ok(
    r.transactionSteps.includes(
      'lock_shared_wallet_then_budget_scope_then_operation_claim'
    )
  );
  assert.ok(
    r.transactionSteps.includes(
      'recheck_original_gate07_wallet_budget_claim_revisions_under_locks'
    )
  );
  assert.ok(
    r.transactionSteps.at(-1).includes('before_any_external_provider_network')
  );
  assert.equal(r.realDatabaseAtomicityProven, false);
  assert.equal(r.liveProviderIdempotencyProven, false);
  assert.equal(r.existingLedgerStatusUsableAsClaimPhase, false);
});

test('all 22 critical durable atomic guard conditions fail closed individually', () => {
  const s = setup();
  const keys = Object.keys(atomicCapabilities());
  assert.equal(keys.length, 22);
  for (const name of keys) {
    const r = contract(s.first, {
      outboxQuote: s.outboxQuote,
      capabilities: atomicCapabilities({ [name]: false })
    });
    assert.equal(r.status, 'durable_atomic_guarantees_unproven', name);
    assert.ok(r.missingRequirements.includes(name));
    noEffects(r);
  }
});

test('unverified or missing capability object never authorizes DB connection', () => {
  const s = setup();
  const r = contract(s.first, {
    outboxQuote: s.outboxQuote,
    capabilities: undefined
  });
  assert.equal(r.status, 'durable_atomic_guarantees_unproven');
  noEffects(r);
});

test('stale wallet, budget, claim or outbox fingerprint stops the atomic proposal', () => {
  const s = setup();
  for (const override of [
    { walletRevision: 99 },
    { budgetRevision: 99 },
    { operationRevision: 99 },
    { userId: 'another-user' },
    { budgetScope: 'another_budget' },
    { outboxPayloadDigest: BAD_DIGEST },
    { providerIdempotencyKey: 'different' },
    { providerRoute: 'different_route' },
    { existingOutbox: true }
  ]) {
    const r = contract(s.first, {
      outboxQuote: s.outboxQuote,
      snapshot: snapshot(s.first, true, override)
    });
    assert.notEqual(
      r.status,
      'atomic_contract_design_only',
      JSON.stringify(override)
    );
    noEffects(r);
  }
});

test('an altered Gate08 plan or forged Gate07 recheck cannot authorize contract', () => {
  const s = setup();
  for (const extra of [
    { gate08Design: { ...s.first.gate08Design, ledgerEventKey: 'forged' } },
    { recheck: { ...s.first.recheck, operationKey: 'forged' } },
    { gate08Design: { ...s.first.gate08Design, status: 'completed' } }
  ]) {
    assert.equal(
      contract(s.first, { ...extra, outboxQuote: s.outboxQuote }).status,
      'gate07_or_gate08_design_not_aligned'
    );
  }
});

test('reserve without unique and immutable Gate09 outbox is rejected', () => {
  const s = setup();
  for (const outboxQuote of [
    undefined,
    { ...s.outboxQuote, idempotencyKey: 'another' },
    { ...s.outboxQuote, operationKey: 'another' },
    { ...s.outboxQuote, status: 'already_enqueued_noop' },
    { ...s.outboxQuote, mayInvokeProvider: true }
  ]) {
    const r = contract(s.first, { outboxQuote });
    assert.notEqual(r.status, 'atomic_contract_design_only');
  }
});

test('confirmed provider result allows a commit DESIGN only with an original claim', () => {
  const s = setup();
  const second = action('commit', s.first.proposal);
  const receiptDecision = reconcile(s);
  const r = contract(second, { receiptDecision });
  assert.equal(r.status, 'atomic_contract_design_only');
  assert.equal(r.action, 'commit');
  assert.equal(r.ledgerEventKey, operationKey + ':commit');
  noEffects(r);
});

test('definitive verified no-fulfillment allows a release DESIGN only', () => {
  const s = setup();
  const second = action('release', s.first.proposal);
  const receiptDecision = reconcile(s, {
    receiptHistory: [receipt({ outcome: 'failed', transactionId: null })],
    providerObservation: provider('not_fulfilled')
  });
  const r = contract(second, { receiptDecision });
  assert.equal(r.status, 'atomic_contract_design_only');
  assert.equal(r.ledgerEventKey, operationKey + ':release');
  noEffects(r);
});

test('conflicting receipt decision cannot be used to settle a committed wallet', () => {
  const s = setup();
  const second = action('commit', s.first.proposal);
  const receiptDecision = reconcile(s, {
    receiptHistory: [
      receipt(),
      receipt({ eventId: 'evt_02', transactionId: 'provider_tx_02' })
    ]
  });
  assert.equal(
    receiptDecision.status,
    'different_provider_transaction_ids_manual_hold'
  );
  assert.equal(
    contract(second, { receiptDecision }).status,
    'provider_reconciliation_not_authoritative'
  );
});

test('a release candidate cannot be substituted for a commit candidate and vice versa', () => {
  const s = setup();
  const second = action('commit', s.first.proposal);
  const rel = reconcile(s, {
    receiptHistory: [receipt({ outcome: 'failed', transactionId: null })],
    providerObservation: provider('not_fulfilled')
  });
  assert.equal(
    contract(second, { receiptDecision: rel }).status,
    'provider_reconciliation_not_authoritative'
  );
});

test('settlement without recorded original outbox cannot produce an atomic design', () => {
  const s = setup();
  const second = action('commit', s.first.proposal);
  const receiptDecision = reconcile(s);
  assert.equal(
    contract(second, {
      receiptDecision,
      snapshot: snapshot(second, false, { existingOutbox: false })
    }).status,
    'settlement_without_durable_outbox_hold'
  );
});

test('settlement cannot reuse the same outbox with changed route or digest', () => {
  const s = setup();
  const second = action('commit', s.first.proposal);
  const receiptDecision = reconcile(s);
  for (const change of [
    { providerRoute: 'wrong_route' },
    { outboxPayloadDigest: BAD_DIGEST },
    { outboxOperationKey: 'other_operation' }
  ]) {
    const result = contract(second, {
      receiptDecision,
      snapshot: snapshot(second, false, change)
    });
    assert.notEqual(result.status, 'atomic_contract_design_only');
  }
});

test('committed refund requires Gate08 independent recovery evidence and cannot recredit budget', () => {
  const s = setup();
  const second = action('commit', s.first.proposal);
  const third = action('refund', second.proposal);
  const recoveryQuote = quoteScoutPointRecovery({
    operation: second.proposal.nextOperation,
    observation: { outcome: 'refunded' },
    evidence: {
      authoritativeOperationSnapshot: true,
      ownerAndProviderIdentityVerified: true,
      originalClaimVerified: true,
      notificationHistoryComplete: true,
      reversalProofVerified: true,
      externalFundsRecovered: true
    }
  });
  assert.equal(recoveryQuote.status, 'refund_candidate_only');
  const result = contract(third, { recoveryQuote });
  assert.equal(result.status, 'atomic_contract_design_only');
  assert.equal(result.ledgerEventKey, operationKey + ':refund');
  assert.equal(
    third.proposal.nextBudget.revision,
    third.proposal.expectedBudget.revision
  );
  noEffects(result);
});

test('refund proof cannot be borrowed from another operation or omitted', () => {
  const s = setup();
  const second = action('commit', s.first.proposal);
  const third = action('refund', second.proposal);
  for (const recoveryQuote of [
    undefined,
    {
      status: 'refund_candidate_only',
      operationId: 'someone',
      mayMovePointsOrMoney: false
    },
    {
      status: 'refund_candidate_only',
      operationId: OP,
      mayMovePointsOrMoney: true
    }
  ]) {
    assert.equal(
      contract(third, { recoveryQuote }).status,
      'refund_recovery_evidence_missing'
    );
  }
});

test('every successful design candidate is still forbidden to mutate, invoke or settle', () => {
  const s = setup();
  const r1 = contract(s.first, { outboxQuote: s.outboxQuote });
  const r2 = contract(action('commit', s.first.proposal), {
    receiptDecision: reconcile(s)
  });
  for (const v of [r1, r2]) {
    assert.equal(v.status, 'atomic_contract_design_only');
    noEffects(v);
  }
});

test('claim action phases cannot cross the Gate07 transition machine', () => {
  const s = setup();
  const r = contract(s.first, {
    outboxQuote: s.outboxQuote,
    snapshot: snapshot(s.first, true, { phase: 'committed' })
  });
  assert.equal(r.status, 'snapshot_or_resource_scope_mismatch');
});
