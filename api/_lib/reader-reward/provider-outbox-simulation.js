// Gate 09: non-executable provider outbox/idempotency and recovery simulations.
// Never contacts a provider or DB; no migration, payout, AI call or state write.
import { SCOUT_POINT_MIN_EXTERNAL_EXCHANGE } from './scout-point-usage.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGEST = /^[a-f0-9]{64}$/;
const ROUTE = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const EVENT_ID = /^[a-zA-Z0-9:_-]{1,120}$/;
const OUTBOX_STATES = new Set([
  'queued',
  'leased',
  'uncertain',
  'delivered',
  'cancelled'
]);
const RECEIPT_OUTCOMES = new Set(['succeeded', 'failed', 'pending', 'partial']);
const boolean = (value) => value === true;
const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const result = (status, fields = {}) =>
  Object.freeze({
    status,
    ...fields,
    mayInvokeProvider: false,
    mayMovePointsOrMoney: false,
    mayConnectDb: false
  });

function operationIdentity(operation) {
  if (
    !object(operation) ||
    !UUID.test(operation.userId) ||
    !UUID.test(operation.operationId) ||
    !['external_exchange', 'ai_direct_use'].includes(operation.purpose) ||
    !Number.isSafeInteger(operation.amountPoints) ||
    operation.amountPoints <= 0 ||
    !Number.isSafeInteger(operation.revision) ||
    operation.revision < 0
  ) {
    throw new TypeError('Authoritative Scout operation identity required');
  }
  return Object.freeze({
    userId: operation.userId.toLowerCase(),
    operationId: operation.operationId.toLowerCase(),
    purpose: operation.purpose,
    amountPoints: operation.amountPoints,
    phase: operation.phase,
    revision: operation.revision,
    operationKey:
      'scout-point-use-v1:' +
      operation.userId.toLowerCase() +
      ':' +
      operation.operationId.toLowerCase()
  });
}
function validPayload(value) {
  return (
    object(value) &&
    DIGEST.test(value.payloadDigest) &&
    ROUTE.test(value.providerRoute)
  );
}
function validOutbox(outbox) {
  return (
    object(outbox) &&
    OUTBOX_STATES.has(outbox.status) &&
    typeof outbox.operationKey === 'string' &&
    validPayload(outbox) &&
    Number.isSafeInteger(outbox.revision) &&
    outbox.revision >= 0
  );
}
function matchOutbox(outbox, op, payload) {
  return (
    outbox.operationKey === op.operationKey &&
    outbox.payloadDigest === payload.payloadDigest &&
    outbox.providerRoute === payload.providerRoute &&
    outbox.purpose === op.purpose &&
    outbox.amountPoints === op.amountPoints
  );
}
function keyFor(op) {
  // Immutable per user/operation, never per attempt/worker. No secrets/PII.
  return 'scout-provider-v1:' + op.userId + ':' + op.operationId;
}

/**
 * A single provider request must correspond to one durable, server-approved
 * reservation + identical immutable provider payload, created in one DB tx.
 * The hex digest is an input from a future trusted backend, NOT calculated
 * from client input or evidence that approval took place.
 */
export function quoteScoutProviderOutboxEnqueue({
  reservedOperation,
  reservationDesign,
  payload,
  existingOutbox = null,
  evidence
}) {
  const op = operationIdentity(reservedOperation);
  if (!validPayload(payload))
    throw new TypeError('Immutable payload digest and route required');
  if (
    op.phase !== 'reserved' ||
    (op.purpose === 'external_exchange' &&
      op.amountPoints < SCOUT_POINT_MIN_EXTERNAL_EXCHANGE)
  ) {
    return result('reservation_or_channel_invalid');
  }
  if (
    !object(reservationDesign) ||
    reservationDesign.status !== 'connection_design_only' ||
    reservationDesign.action !== 'reserve' ||
    reservationDesign.operationKey !== op.operationKey ||
    reservationDesign.mayMovePointsOrMoney !== false
  ) {
    return result('gate08_reservation_design_mismatch');
  }
  if (
    !object(evidence) ||
    !boolean(evidence.serverIdentityVerified) ||
    !boolean(evidence.reservationClaimAndLedgerVerified) ||
    !boolean(evidence.atomicOutboxWithReservationVerified) ||
    !boolean(evidence.authorizedBudgetAndPointEligibility) ||
    !boolean(evidence.riskAndIdentityCleared) ||
    !boolean(evidence.providerRouteAndIdempotencyContractVerified) ||
    !boolean(evidence.immutablePayloadBoundToApprovedTerms) ||
    !boolean(evidence.privateOutboxAndAuditVerified) ||
    (op.purpose === 'ai_direct_use' && !boolean(evidence.aiPriceApproved))
  ) {
    return result('outbox_evidence_or_policy_incomplete');
  }
  if (existingOutbox !== null) {
    if (!validOutbox(existingOutbox)) return result('outbox_snapshot_invalid');
    if (!matchOutbox(existingOutbox, op, payload)) {
      return result('operation_id_or_payload_collision');
    }
    // Retry of the same logical request is a no-op, NOT a second enqueue.
    return result('already_enqueued_noop', {
      operationKey: op.operationKey,
      idempotencyKey: keyFor(op)
    });
  }
  return result('outbox_enqueue_quote_only', {
    operationKey: op.operationKey,
    idempotencyKey: keyFor(op),
    requestFingerprint: payload.payloadDigest,
    providerRoute: payload.providerRoute,
    purpose: op.purpose,
    amountPoints: op.amountPoints,
    nextOutbox: Object.freeze({
      operationKey: op.operationKey,
      providerRoute: payload.providerRoute,
      payloadDigest: payload.payloadDigest,
      purpose: op.purpose,
      amountPoints: op.amountPoints,
      status: 'queued',
      revision: 0
    })
  });
}

/**
 * A lease and CAS are required before any provider work. An expired lease,
 * unknown send outcome or missing provider guarantee NEVER implies no send.
 * All positive results are design quotes, not executable dispatch permits.
 */
export function quoteScoutProviderDispatch({ operation, outbox, evidence }) {
  const op = operationIdentity(operation);
  if (!validOutbox(outbox)) return result('outbox_snapshot_invalid');
  if (!matchOutbox(outbox, op, outbox))
    return result('outbox_operation_mismatch');
  if (op.phase !== 'reserved') return result('operation_not_reserved');
  if (outbox.status === 'delivered' || outbox.status === 'cancelled') {
    return result('terminal_outbox_noop');
  }
  if (outbox.status === 'leased' || outbox.status === 'uncertain') {
    return result('unknown_delivery_hold_reconcile');
  }
  if (
    !object(evidence) ||
    !boolean(evidence.serverWorkerAuthorized) ||
    !boolean(evidence.exclusiveLeaseAndRevisionCasVerified) ||
    !boolean(evidence.originalReservationLockedAndVerified) ||
    !boolean(evidence.providerDeduplicationContractVerified) ||
    !boolean(evidence.immutablePayloadRechecked) ||
    !boolean(evidence.frozenRiskBudgetAndEligibilityRechecked) ||
    !boolean(evidence.atomicAttemptAuditVerified)
  ) {
    return result('dispatch_safeguards_incomplete');
  }
  return result('first_dispatch_quote_only', {
    idempotencyKey: keyFor(op),
    requestFingerprint: outbox.payloadDigest,
    providerRoute: outbox.providerRoute,
    requiresLeaseBeforeAnyNetworkCall: true,
    externalExecutionInsideDbTransaction: false
  });
}

/**
 * Signed provider notifications and independently verified provider status
 * are evidence for an eventual Gate07 commit/release quote, not settlement.
 * A repeated event ID or transaction ID can never generate a second credit.
 */
export function quoteScoutProviderNotification({
  operation,
  outbox,
  receipt,
  existingReceipts,
  evidence
}) {
  const op = operationIdentity(operation);
  if (
    !validOutbox(outbox) ||
    !object(receipt) ||
    !EVENT_ID.test(receipt.eventId) ||
    !RECEIPT_OUTCOMES.has(receipt.outcome) ||
    !Array.isArray(existingReceipts)
  ) {
    throw new TypeError('Well-formed signed notification context required');
  }
  if (
    !matchOutbox(outbox, op, outbox) ||
    receipt.operationKey !== op.operationKey ||
    receipt.providerRoute !== outbox.providerRoute ||
    receipt.payloadDigest !== outbox.payloadDigest
  ) {
    return result('notification_binding_mismatch');
  }
  if (
    !object(evidence) ||
    !boolean(evidence.trustedAuthenticatedProvider) ||
    !boolean(evidence.receiptSignatureAndRouteVerified) ||
    !boolean(evidence.completeNotificationHistoryVerified) ||
    !boolean(evidence.authoritativeProviderStatusQueried) ||
    !boolean(evidence.operationLedgerAndBudgetCasVerified)
  ) {
    return result('notification_evidence_incomplete');
  }
  const seenEventIds = new Set();
  for (const saved of existingReceipts) {
    if (
      !object(saved) ||
      !EVENT_ID.test(saved.eventId) ||
      !RECEIPT_OUTCOMES.has(saved.outcome) ||
      !DIGEST.test(saved.payloadDigest) ||
      !EVENT_ID.test(saved.providerRoute) ||
      typeof saved.operationKey !== 'string'
    ) {
      return result('history_invalid_hold');
    }
    if (seenEventIds.has(saved.eventId))
      return result('history_duplicate_hold');
    seenEventIds.add(saved.eventId);
    if (
      saved.operationKey !== op.operationKey ||
      saved.providerRoute !== outbox.providerRoute ||
      saved.payloadDigest !== outbox.payloadDigest
    ) {
      return result('history_binding_mismatch');
    }
    if (saved.eventId === receipt.eventId) {
      if (
        saved.outcome === receipt.outcome &&
        saved.transactionId === receipt.transactionId
      ) {
        return result('duplicate_notification_noop');
      }
      return result('event_id_collision_hold');
    }
    if (
      receipt.outcome === 'succeeded' &&
      saved.outcome === 'succeeded' &&
      saved.transactionId === receipt.transactionId &&
      typeof receipt.transactionId === 'string'
    ) {
      return result('same_provider_transaction_reconcile');
    }
  }
  if (
    op.phase === 'committed' ||
    op.phase === 'released' ||
    op.phase === 'refunded'
  ) {
    return result('terminal_operation_reconcile_only');
  }
  if (op.phase !== 'reserved') return result('no_reservation_hold');
  if (receipt.outcome === 'pending') return result('provider_pending_hold');
  if (receipt.outcome === 'partial')
    return result('partial_fulfillment_manual_review');
  if (
    receipt.outcome === 'succeeded' &&
    EVENT_ID.test(receipt.transactionId) &&
    boolean(evidence.fulfillmentProofVerified)
  ) {
    return result('commit_candidate_only', {
      operationKey: op.operationKey,
      ledgerEventKey: op.operationKey + ':commit'
    });
  }
  if (
    receipt.outcome === 'failed' &&
    boolean(evidence.noExternalFulfillmentProven) &&
    boolean(evidence.definitiveProviderFailureVerified)
  ) {
    return result('release_candidate_only', {
      operationKey: op.operationKey,
      ledgerEventKey: op.operationKey + ':release'
    });
  }
  return result('ambiguous_provider_result_hold');
}

/**
 * Simulation of crash windows only. Reservation, outbox and ledger MUST be
 * durable together. Reconciliation does not issue provider calls or credits.
 */
export function quoteScoutOutboxCrashRecovery({ operation, outbox, proof }) {
  const op = operationIdentity(operation);
  if (!object(proof)) return result('recovery_evidence_incomplete');
  if (
    !boolean(proof.authoritativeSnapshotVerified) ||
    !boolean(proof.completeLedgerAndOutboxHistoryVerified) ||
    !boolean(proof.providerIdentityAndIdempotencyVerified)
  ) {
    return result('recovery_evidence_incomplete');
  }
  if (
    typeof proof.reservationDurable !== 'boolean' ||
    typeof proof.ledgerReservationDurable !== 'boolean' ||
    typeof proof.outboxDurable !== 'boolean'
  ) {
    return result('atomicity_evidence_missing');
  }
  if (
    proof.reservationDurable !== proof.ledgerReservationDurable ||
    proof.reservationDurable !== proof.outboxDurable ||
    (proof.outboxDurable && !validOutbox(outbox))
  ) {
    return result('atomicity_invariant_breach_manual_hold');
  }
  if (!proof.reservationDurable)
    return result('no_durable_intent_no_external_call');
  if (!matchOutbox(outbox, op, outbox))
    return result('outbox_operation_mismatch');
  if (op.phase === 'released' || op.phase === 'refunded') {
    return result('terminal_noop');
  }
  if (op.phase === 'committed')
    return result('committed_verify_ledger_no_replay');
  if (op.phase !== 'reserved') return result('phase_conflict_manual_hold');
  if (outbox.status !== 'queued')
    return result('provider_unknown_hold_reconcile');
  return result('queued_needs_authoritative_dispatch_review');
}
