import assert from 'node:assert/strict';
import test from 'node:test';
import {
  quoteScoutProviderOutboxEnqueue,
  quoteScoutProviderDispatch,
  quoteScoutProviderNotification,
  quoteScoutOutboxCrashRecovery
} from '../api/_lib/reader-reward/provider-outbox-simulation.js';
import {
  quoteScoutPointOperation,
  recheckScoutPointOperation
} from '../api/_lib/reader-reward/point-settlement.js';
import { quoteScoutPointAtomicConnection } from '../api/_lib/reader-reward/atomic-connection-plan.js';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OP2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DIGEST = 'a'.repeat(64);
const DIGEST_OTHER = 'b'.repeat(64);

const budget = () => ({
  scopeId: 'approved-test-scope-only',
  limitPoints: 99990,
  committedPoints: 0,
  reservedPoints: 0,
  revision: 3
});
const wallet = () => ({
  userId: USER,
  availablePoints: 50000,
  reservedPoints: 0,
  revision: 5
});
const op = (overrides = {}) => ({
  userId: USER,
  operationId: OP,
  purpose: 'external_exchange',
  amountPoints: 30000,
  phase: 'new',
  revision: 0,
  ...overrides
});
const gate07 = () => ({
  authoritativeStateVerified: true,
  budgetPolicyApproved: true,
  pointEligibilityVerified: true,
  riskAndControlsCleared: true,
  operationUniquenessVerified: true,
  channelPolicyApproved: true,
  aiPriceApproved: true
});
const gate08 = () => ({
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
const enqueueEvidence = (overrides = {}) => ({
  serverIdentityVerified: true,
  reservationClaimAndLedgerVerified: true,
  atomicOutboxWithReservationVerified: true,
  authorizedBudgetAndPointEligibility: true,
  riskAndIdentityCleared: true,
  providerRouteAndIdempotencyContractVerified: true,
  immutablePayloadBoundToApprovedTerms: true,
  privateOutboxAndAuditVerified: true,
  aiPriceApproved: true,
  ...overrides
});
const dispatchEvidence = (overrides = {}) => ({
  serverWorkerAuthorized: true,
  exclusiveLeaseAndRevisionCasVerified: true,
  originalReservationLockedAndVerified: true,
  providerDeduplicationContractVerified: true,
  immutablePayloadRechecked: true,
  frozenRiskBudgetAndEligibilityRechecked: true,
  atomicAttemptAuditVerified: true,
  ...overrides
});
const receiptEvidence = (overrides = {}) => ({
  trustedAuthenticatedProvider: true,
  receiptSignatureAndRouteVerified: true,
  completeNotificationHistoryVerified: true,
  authoritativeProviderStatusQueried: true,
  operationLedgerAndBudgetCasVerified: true,
  fulfillmentProofVerified: true,
  noExternalFulfillmentProven: true,
  definitiveProviderFailureVerified: true,
  ...overrides
});
const recoveryProof = (overrides = {}) => ({
  authoritativeSnapshotVerified: true,
  completeLedgerAndOutboxHistoryVerified: true,
  providerIdentityAndIdempotencyVerified: true,
  reservationDurable: true,
  ledgerReservationDurable: true,
  outboxDurable: true,
  ...overrides
});

function setup({
  operation = op(),
  payload = { payloadDigest: DIGEST, providerRoute: 'test_route' }
} = {}) {
  const proposal = quoteScoutPointOperation({
    action: 'reserve',
    walletSnapshot: wallet(),
    budgetSnapshot: budget(),
    operationSnapshot: operation,
    evidence: gate07()
  });
  assert.equal(proposal.status, 'proposal_only');
  const precheck = recheckScoutPointOperation({
    proposal,
    currentWalletSnapshot: proposal.expectedWallet,
    currentBudgetSnapshot: proposal.expectedBudget,
    currentOperationSnapshot: proposal.expectedOperation,
    duplicateOperationClaimVerified: true,
    duplicateOperationClaimExists: false
  });
  const reservationDesign = quoteScoutPointAtomicConnection({
    proposal,
    recheck: precheck,
    safeguards: gate08()
  });
  assert.equal(reservationDesign.status, 'connection_design_only');
  const reservedOperation = proposal.nextOperation;

  const enqueued = quoteScoutProviderOutboxEnqueue({
    reservedOperation,
    reservationDesign,
    payload,
    evidence: enqueueEvidence()
  });
  assert.equal(enqueued.status, 'outbox_enqueue_quote_only');
  return {
    reservedOperation,
    reservationDesign,
    payload,
    enqueued,
    outbox: enqueued.nextOutbox
  };
}
const notification = (s, receipt, overrides = {}) =>
  quoteScoutProviderNotification({
    operation: s.reservedOperation,
    outbox: s.outbox,
    receipt: {
      eventId: 'evt_001',
      operationKey: s.enqueued.operationKey,
      providerRoute: s.payload.providerRoute,
      payloadDigest: s.payload.payloadDigest,
      outcome: 'succeeded',
      transactionId: 'transaction_001',
      ...receipt
    },
    existingReceipts: [],
    evidence: receiptEvidence(),
    ...overrides
  });
const recovery = (s, overrides = {}) =>
  quoteScoutOutboxCrashRecovery({
    operation: s.reservedOperation,
    outbox: s.outbox,
    proof: recoveryProof(),
    ...overrides
  });

test('Gate07/Gate08 integration yields one immutable provider intent and no side effects', () => {
  const s = setup();
  assert.equal(s.enqueued.mayInvokeProvider, false);
  assert.equal(s.enqueued.mayConnectDb, false);
  assert.equal(s.enqueued.mayMovePointsOrMoney, false);
  assert.equal(s.outbox.status, 'queued');
  assert.equal(Object.isFrozen(s.outbox), true);
  assert.ok(s.enqueued.idempotencyKey.endsWith(':' + OP));
});

test('the same logical operation always uses the same provider idempotency key', () => {
  const s = setup();
  const again = quoteScoutProviderOutboxEnqueue({
    reservedOperation: s.reservedOperation,
    reservationDesign: s.reservationDesign,
    payload: s.payload,
    existingOutbox: s.outbox,
    evidence: enqueueEvidence()
  });
  assert.equal(again.status, 'already_enqueued_noop');
  assert.equal(again.idempotencyKey, s.enqueued.idempotencyKey);
  assert.equal(again.mayInvokeProvider, false);
});

test('same operation ID with changed amount, purpose, digest, route is rejected', () => {
  const s = setup();
  for (const changes of [
    { reservedOperation: { ...s.reservedOperation, amountPoints: 30010 } },
    { reservedOperation: { ...s.reservedOperation, purpose: 'ai_direct_use' } },
    { payload: { ...s.payload, payloadDigest: DIGEST_OTHER } },
    { payload: { ...s.payload, providerRoute: 'different_route' } }
  ]) {
    const result = quoteScoutProviderOutboxEnqueue({
      reservedOperation: s.reservedOperation,
      reservationDesign: s.reservationDesign,
      payload: s.payload,
      existingOutbox: s.outbox,
      evidence: enqueueEvidence(),
      ...changes
    });
    assert.equal(result.status, 'operation_id_or_payload_collision');
  }
});

test('different operation IDs cannot share the provider request key', () => {
  const first = setup();
  const second = setup({ operation: op({ operationId: OP2 }) });
  assert.notEqual(
    first.enqueued.idempotencyKey,
    second.enqueued.idempotencyKey
  );
});

test('AI direct use accepts approved 1pt trial price while exchange has 3000pt floor', () => {
  const ai = setup({
    operation: op({ purpose: 'ai_direct_use', amountPoints: 1 })
  });
  assert.equal(ai.enqueued.purpose, 'ai_direct_use');
  const blocked = quoteScoutProviderOutboxEnqueue({
    reservedOperation: {
      ...ai.reservedOperation,
      purpose: 'external_exchange',
      amountPoints: 1
    },
    reservationDesign: ai.reservationDesign,
    payload: ai.payload,
    evidence: enqueueEvidence()
  });
  assert.equal(blocked.status, 'reservation_or_channel_invalid');
});

test('unknown AI pricing and all missing owner/budget/risk proofs fail closed', () => {
  const s = setup();
  for (const flag of Object.keys(enqueueEvidence())) {
    const denied = quoteScoutProviderOutboxEnqueue({
      reservedOperation: s.reservedOperation,
      reservationDesign: s.reservationDesign,
      payload: s.payload,
      evidence: enqueueEvidence({ [flag]: false })
    });
    if (flag === 'aiPriceApproved') continue;
    assert.equal(denied.status, 'outbox_evidence_or_policy_incomplete', flag);
  }
  const ai = setup({
    operation: op({ purpose: 'ai_direct_use', amountPoints: 2 })
  });
  assert.equal(
    quoteScoutProviderOutboxEnqueue({
      reservedOperation: ai.reservedOperation,
      reservationDesign: ai.reservationDesign,
      payload: ai.payload,
      evidence: enqueueEvidence({ aiPriceApproved: false })
    }).status,
    'outbox_evidence_or_policy_incomplete'
  );
});

test('a forged Gate08 plan or missing reserved phase cannot enqueue', () => {
  const s = setup();
  assert.equal(
    quoteScoutProviderOutboxEnqueue({
      reservedOperation: s.reservedOperation,
      reservationDesign: { ...s.reservationDesign, operationKey: 'forged' },
      payload: s.payload,
      evidence: enqueueEvidence()
    }).status,
    'gate08_reservation_design_mismatch'
  );
  assert.equal(
    quoteScoutProviderOutboxEnqueue({
      reservedOperation: { ...s.reservedOperation, phase: 'committed' },
      reservationDesign: s.reservationDesign,
      payload: s.payload,
      evidence: enqueueEvidence()
    }).status,
    'reservation_or_channel_invalid'
  );
});

test('invalid fingerprints, routes and outbox snapshots are rejected', () => {
  const s = setup();
  assert.throws(
    () =>
      quoteScoutProviderOutboxEnqueue({
        reservedOperation: s.reservedOperation,
        reservationDesign: s.reservationDesign,
        payload: { payloadDigest: 'not-digest', providerRoute: 'test_route' },
        evidence: enqueueEvidence()
      }),
    TypeError
  );
  assert.equal(
    quoteScoutProviderOutboxEnqueue({
      reservedOperation: s.reservedOperation,
      reservationDesign: s.reservationDesign,
      payload: s.payload,
      existingOutbox: { status: 'faked' },
      evidence: enqueueEvidence()
    }).status,
    'outbox_snapshot_invalid'
  );
});

test('a uniquely leased queued outbox only produces a design quote', () => {
  const s = setup();
  const q = quoteScoutProviderDispatch({
    operation: s.reservedOperation,
    outbox: s.outbox,
    evidence: dispatchEvidence()
  });
  assert.equal(q.status, 'first_dispatch_quote_only');
  assert.equal(q.idempotencyKey, s.enqueued.idempotencyKey);
  assert.equal(q.mayInvokeProvider, false);
  assert.equal(q.requiresLeaseBeforeAnyNetworkCall, true);
});

test('missing exclusive CAS, provider idempotency or fraud guards deny dispatch', () => {
  const s = setup();
  for (const flag of Object.keys(dispatchEvidence())) {
    assert.equal(
      quoteScoutProviderDispatch({
        operation: s.reservedOperation,
        outbox: s.outbox,
        evidence: dispatchEvidence({ [flag]: false })
      }).status,
      'dispatch_safeguards_incomplete',
      flag
    );
  }
});

test('leased, expired, uncertain, delivered or cancelled cannot be resent', () => {
  const s = setup();
  for (const status of ['leased', 'uncertain', 'delivered', 'cancelled']) {
    const outcome = quoteScoutProviderDispatch({
      operation: s.reservedOperation,
      outbox: { ...s.outbox, status },
      evidence: dispatchEvidence({ leaseExpired: true })
    });
    assert.equal(
      outcome.status,
      ['leased', 'uncertain'].includes(status)
        ? 'unknown_delivery_hold_reconcile'
        : 'terminal_outbox_noop'
    );
    assert.equal(outcome.mayInvokeProvider, false);
  }
});

test('an already committed or changed operation cannot be dispatched', () => {
  const s = setup();
  assert.equal(
    quoteScoutProviderDispatch({
      operation: { ...s.reservedOperation, phase: 'committed' },
      outbox: s.outbox,
      evidence: dispatchEvidence()
    }).status,
    'operation_not_reserved'
  );
  assert.equal(
    quoteScoutProviderDispatch({
      operation: { ...s.reservedOperation, amountPoints: 40 },
      outbox: s.outbox,
      evidence: dispatchEvidence()
    }).status,
    'outbox_operation_mismatch'
  );
});

test('authenticated success creates only stable commit candidate, not debit', () => {
  const s = setup();
  const q = notification(s, {});
  assert.equal(q.status, 'commit_candidate_only');
  assert.ok(q.ledgerEventKey.endsWith(':commit'));
  assert.equal(q.mayInvokeProvider, false);
  assert.equal(q.mayMovePointsOrMoney, false);
});

test('authenticated definite failure creates release candidate, unknown failure does not', () => {
  const s = setup();
  assert.equal(
    notification(s, { outcome: 'failed', transactionId: undefined }).status,
    'release_candidate_only'
  );
  assert.equal(
    notification(
      s,
      { outcome: 'failed' },
      {
        evidence: receiptEvidence({ noExternalFulfillmentProven: false })
      }
    ).status,
    'ambiguous_provider_result_hold'
  );
});

test('pending and partial outcomes stay on hold', () => {
  const s = setup();
  assert.equal(
    notification(s, { outcome: 'pending' }).status,
    'provider_pending_hold'
  );
  assert.equal(
    notification(s, { outcome: 'partial' }).status,
    'partial_fulfillment_manual_review'
  );
});

test('provider authenticity, complete history, CAS and identity checks must all hold', () => {
  const s = setup();
  for (const flag of [
    'trustedAuthenticatedProvider',
    'receiptSignatureAndRouteVerified',
    'completeNotificationHistoryVerified',
    'authoritativeProviderStatusQueried',
    'operationLedgerAndBudgetCasVerified'
  ]) {
    assert.equal(
      notification(
        s,
        {},
        {
          evidence: receiptEvidence({ [flag]: false })
        }
      ).status,
      'notification_evidence_incomplete',
      flag
    );
  }
});

test('wrong user, route, digest or operation key prevents notifications', () => {
  const s = setup();
  for (const override of [
    { operationKey: 'another-key' },
    { payloadDigest: DIGEST_OTHER },
    { providerRoute: 'wrong_route' }
  ]) {
    assert.equal(
      notification(s, override).status,
      'notification_binding_mismatch'
    );
  }
  assert.equal(
    notification(
      s,
      {},
      {
        operation: {
          ...s.reservedOperation,
          userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
        }
      }
    ).status,
    'notification_binding_mismatch'
  );
});

test('duplicate callback ID with same payload is no-op', () => {
  const s = setup();
  const receipt = {
    eventId: 'evt_001',
    outcome: 'succeeded',
    transactionId: 'transaction_001',
    operationKey: s.enqueued.operationKey,
    providerRoute: 'test_route',
    payloadDigest: DIGEST
  };
  assert.equal(
    notification(s, receipt, { existingReceipts: [receipt] }).status,
    'duplicate_notification_noop'
  );
});

test('same callback ID with different outcome is a conflict hold', () => {
  const s = setup();
  const past = {
    eventId: 'evt_001',
    outcome: 'pending',
    transactionId: 'transaction_001',
    operationKey: s.enqueued.operationKey,
    providerRoute: 'test_route',
    payloadDigest: DIGEST
  };
  assert.equal(
    notification(s, {}, { existingReceipts: [past] }).status,
    'event_id_collision_hold'
  );
});

test('same provider transaction with different callback ID requires reconciliation', () => {
  const s = setup();
  const past = {
    eventId: 'evt_000',
    outcome: 'succeeded',
    transactionId: 'transaction_001',
    operationKey: s.enqueued.operationKey,
    providerRoute: 'test_route',
    payloadDigest: DIGEST
  };
  assert.equal(
    notification(s, {}, { existingReceipts: [past] }).status,
    'same_provider_transaction_reconcile'
  );
});

test('missing or inconsistent notification history fails closed', () => {
  const s = setup();
  assert.equal(
    notification(s, {}, { existingReceipts: [{ eventId: 'bad' }] }).status,
    'history_invalid_hold'
  );
  assert.equal(
    notification(
      s,
      {},
      {
        existingReceipts: [
          {
            eventId: 'evt_old',
            outcome: 'pending',
            payloadDigest: DIGEST,
            providerRoute: 'test_route',
            operationKey: s.enqueued.operationKey
          },
          {
            eventId: 'evt_old',
            outcome: 'pending',
            payloadDigest: DIGEST,
            providerRoute: 'test_route',
            operationKey: s.enqueued.operationKey
          }
        ]
      }
    ).status,
    'history_duplicate_hold'
  );
});

test('already committed and released operations do not settle again', () => {
  const s = setup();
  for (const phase of ['committed', 'released', 'refunded']) {
    assert.equal(
      notification(
        s,
        {},
        {
          operation: { ...s.reservedOperation, phase }
        }
      ).status,
      'terminal_operation_reconcile_only'
    );
  }
});

test('crash before transaction commit creates no provider intent', () => {
  const s = setup();
  const q = recovery(s, {
    outbox: null,
    proof: recoveryProof({
      reservationDurable: false,
      ledgerReservationDurable: false,
      outboxDurable: false
    })
  });
  assert.equal(q.status, 'no_durable_intent_no_external_call');
  assert.equal(q.mayInvokeProvider, false);
});

test('reserved wallet without outbox or ledger is invariant violation', () => {
  const s = setup();
  for (const bad of [
    {
      reservationDurable: true,
      ledgerReservationDurable: true,
      outboxDurable: false
    },
    {
      reservationDurable: true,
      ledgerReservationDurable: false,
      outboxDurable: true
    },
    {
      reservationDurable: false,
      ledgerReservationDurable: false,
      outboxDurable: true
    }
  ]) {
    assert.equal(
      recovery(s, { proof: recoveryProof(bad) }).status,
      'atomicity_invariant_breach_manual_hold'
    );
  }
});

test('crash after queue creation only permits review; never auto-dispatch', () => {
  const s = setup();
  const q = recovery(s);
  assert.equal(q.status, 'queued_needs_authoritative_dispatch_review');
  assert.equal(q.mayInvokeProvider, false);
});

test('a crash after lease, send or unknown outcome is held without retry', () => {
  const s = setup();
  for (const status of ['leased', 'uncertain', 'delivered']) {
    assert.equal(
      recovery(s, {
        outbox: { ...s.outbox, status }
      }).status,
      'provider_unknown_hold_reconcile'
    );
  }
});

test('commit acknowledged after a crash does not replay the provider', () => {
  const s = setup();
  assert.equal(
    recovery(s, {
      operation: { ...s.reservedOperation, phase: 'committed' }
    }).status,
    'committed_verify_ledger_no_replay'
  );
});

test('missing trusted recovery evidence blocks replay', () => {
  const s = setup();
  for (const flag of [
    'authoritativeSnapshotVerified',
    'completeLedgerAndOutboxHistoryVerified',
    'providerIdentityAndIdempotencyVerified'
  ]) {
    assert.equal(
      recovery(s, { proof: recoveryProof({ [flag]: false }) }).status,
      'recovery_evidence_incomplete'
    );
  }
});

test('crash recovery cannot repurpose another user operation', () => {
  const s = setup();
  assert.equal(
    recovery(s, {
      operation: { ...s.reservedOperation, operationId: OP2 }
    }).status,
    'outbox_operation_mismatch'
  );
});
