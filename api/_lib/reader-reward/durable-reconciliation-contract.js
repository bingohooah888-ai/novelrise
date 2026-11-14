// Gate 11: non-executable multi-receipt reconciliation and atomic-resource contract.
// Input attestations are hypothetical design conditions, NOT live authority.
// No SQL, migration, Supabase connection, payout, provider network or AI calls.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGEST = /^[a-f0-9]{64}$/;
const EVENT = /^[a-zA-Z0-9:_-]{1,120}$/;
const PURPOSES = new Set(['external_exchange', 'ai_direct_use']);
const ACTIONS = new Set(['reserve', 'commit', 'release', 'refund']);
const RECEIPTS = new Set(['pending', 'partial', 'succeeded', 'failed']);
const PROVIDER_STATES = new Set([
  'unknown',
  'pending',
  'partial',
  'fulfilled',
  'not_fulfilled'
]);
const REQUIRED_ATOMIC_GUARDS = Object.freeze([
  'trustedServerOnlyPrincipal',
  'authoritativeEligibleLedgerReconciled',
  'betaPointAndSpendingPolicyApproved',
  'identityFraudAndSpendingFreezeVerified',
  'scopeBudgetApproved',
  'singleSerializableDatabaseTransaction',
  'globalWalletBudgetClaimLockOrder',
  'walletRevisionCompareAndSwap',
  'budgetRevisionCompareAndSwap',
  'durableOperationClaimUnique',
  'operationPhaseRevisionCompareAndSwap',
  'uniquePhaseLedgerEvent',
  'uniqueReversalOfOriginal',
  'outboxUniquePerOperation',
  'outboxPayloadImmutable',
  'claimWalletBudgetLedgerOutboxAuditSameCommit',
  'notificationJournalAndReceiptDedupDurable',
  'providerIdempotencyAndStatusQueryContract',
  'providerFinalityAndReversalPolicyVerified',
  'legacyPointPathsSerialized',
  'privilegedRpcAndRlsAudited',
  'networkOnlyAfterDatabaseCommit'
]);
const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const trueOnly = (value) => value === true;
const immutable = (value) => Object.freeze(value);
const quote = (status, extras = {}) =>
  immutable({
    status,
    ...extras,
    mayConnectDb: false,
    mayInvokeProvider: false,
    mayMovePointsOrMoney: false,
    maySettle: false
  });
const opKey = (op) =>
  'scout-point-use-v1:' +
  op.userId.toLowerCase() +
  ':' +
  op.operationId.toLowerCase();
const idempotencyKey = (op) =>
  'scout-provider-v1:' +
  op.userId.toLowerCase() +
  ':' +
  op.operationId.toLowerCase();

function verifyOperation(op) {
  if (
    !object(op) ||
    !UUID.test(op.userId) ||
    !UUID.test(op.operationId) ||
    !PURPOSES.has(op.purpose) ||
    !Number.isSafeInteger(op.amountPoints) ||
    op.amountPoints <= 0 ||
    !['new', 'reserved', 'committed', 'released', 'refunded'].includes(
      op.phase
    ) ||
    !Number.isSafeInteger(op.revision) ||
    op.revision < 0
  ) {
    throw new TypeError('A valid mock operation is required');
  }
}
function bindingMatches(op, outbox) {
  return (
    object(outbox) &&
    outbox.operationKey === opKey(op) &&
    outbox.purpose === op.purpose &&
    outbox.amountPoints === op.amountPoints &&
    DIGEST.test(outbox.payloadDigest) &&
    typeof outbox.providerRoute === 'string' &&
    EVENT.test(outbox.providerRoute)
  );
}
function receiptWellFormed(receipt) {
  return (
    object(receipt) &&
    EVENT.test(receipt.eventId) &&
    RECEIPTS.has(receipt.outcome) &&
    receipt.operationKey?.length > 0 &&
    typeof receipt.operationKey === 'string' &&
    typeof receipt.providerRoute === 'string' &&
    DIGEST.test(receipt.payloadDigest) &&
    (receipt.transactionId === null ||
      receipt.transactionId === undefined ||
      EVENT.test(receipt.transactionId))
  );
}
function receiptBindingMatches(receipt, operation, outbox) {
  return (
    receipt.operationKey === opKey(operation) &&
    receipt.providerRoute === outbox.providerRoute &&
    receipt.payloadDigest === outbox.payloadDigest &&
    receipt.providerIdempotencyKey === idempotencyKey(operation)
  );
}
function receiptSignature(receipt) {
  return [
    receipt.eventId,
    receipt.outcome,
    receipt.transactionId ?? '',
    receipt.operationKey,
    receipt.providerRoute,
    receipt.payloadDigest,
    receipt.providerIdempotencyKey
  ].join('|');
}

/**
 * Gate10 found that an earlier per-callback "commit_candidate" can appear
 * BEFORE a later conflicting success/failure callback arrives. This quote
 * examines the *complete immutable history and fresh provider query* as
 * one reconciliation unit. It never authorizes settlement or provider calls.
 *
 * A provider query + flags supplied in tests are NOT an attestation of live
 * provider truth. The future backend must verify cryptographic signatures,
 * claim ownership, source, freshness, history and the DB phase itself.
 */
export function quoteScoutReceiptConsistency({
  operation,
  outbox,
  receiptHistory,
  providerObservation,
  evidence
}) {
  verifyOperation(operation);
  if (!object(outbox) || !Array.isArray(receiptHistory)) {
    throw new TypeError('Mock outbox and receipt history required');
  }
  if (receiptHistory.length > 100) return quote('history_capacity_hold');
  if (!bindingMatches(operation, outbox)) {
    return quote('operation_outbox_binding_hold');
  }
  if (
    !object(evidence) ||
    !trueOnly(evidence.serverPrincipalAuthenticated) ||
    !trueOnly(evidence.claimOwnerAndPhaseVerified) ||
    !trueOnly(evidence.receiptSignaturesAndSourceVerified) ||
    !trueOnly(evidence.completeOrderedDurableReceiptHistoryVerified) ||
    !trueOnly(evidence.authoritativeProviderQueryVerified) ||
    !trueOnly(evidence.providerFinalityAndReversalPolicyVerified) ||
    !trueOnly(evidence.providerQueryFreshnessVerified) ||
    !trueOnly(evidence.outboxPayloadAndIdempotencyContractVerified) ||
    !trueOnly(evidence.walletBudgetAndLedgerCasVerified)
  ) {
    return quote('reconciliation_evidence_missing');
  }
  if (
    !object(providerObservation) ||
    !PROVIDER_STATES.has(providerObservation.state) ||
    providerObservation.operationKey !== opKey(operation) ||
    providerObservation.providerRoute !== outbox.providerRoute ||
    providerObservation.payloadDigest !== outbox.payloadDigest ||
    providerObservation.providerIdempotencyKey !== idempotencyKey(operation) ||
    !(
      providerObservation.transactionId === null ||
      EVENT.test(providerObservation.transactionId)
    )
  ) {
    return quote('provider_observation_unbound_hold');
  }
  const eventSignatures = new Map();
  const transactionIds = new Set();
  const outcomes = new Set();
  for (const receipt of receiptHistory) {
    if (!receiptWellFormed(receipt)) {
      return quote('invalid_receipt_hold');
    }
    if (!receiptBindingMatches(receipt, operation, outbox)) {
      return quote('receipt_scope_or_payload_mismatch_hold');
    }
    const fingerprint = receiptSignature(receipt);
    if (eventSignatures.has(receipt.eventId)) {
      if (eventSignatures.get(receipt.eventId) !== fingerprint) {
        return quote('event_id_collision_hold');
      }
      continue; // An exact duplicate is the same receipt, not new evidence.
    }
    eventSignatures.set(receipt.eventId, fingerprint);
    outcomes.add(receipt.outcome);
    if (receipt.transactionId !== null && receipt.transactionId !== undefined) {
      transactionIds.add(receipt.transactionId);
    }
  }
  if (transactionIds.size > 1) {
    return quote('different_provider_transaction_ids_manual_hold', {
      distinctTransactionCount: transactionIds.size
    });
  }
  if (outcomes.has('succeeded') && outcomes.has('failed')) {
    return quote('success_failure_contradiction_manual_hold');
  }
  if (outcomes.has('partial') || providerObservation.state === 'partial') {
    return quote('partial_fulfillment_manual_hold');
  }
  if (operation.phase === 'released' || operation.phase === 'refunded') {
    return quote('terminal_operation_noop');
  }
  if (operation.phase === 'committed') {
    return quote('committed_operation_noop');
  }
  if (operation.phase !== 'reserved') {
    return quote('no_durable_reservation_hold');
  }
  if (
    outcomes.has('succeeded') &&
    providerObservation.state === 'not_fulfilled'
  ) {
    return quote('provider_and_receipts_disagree_hold');
  }
  if (outcomes.has('failed') && providerObservation.state === 'fulfilled') {
    return quote('provider_and_receipts_disagree_hold');
  }
  if (
    providerObservation.state === 'unknown' ||
    providerObservation.state === 'pending' ||
    receiptHistory.length === 0
  ) {
    return quote('unknown_fulfillment_hold');
  }
  if (providerObservation.state === 'fulfilled') {
    if (
      !outcomes.has('succeeded') ||
      !providerObservation.transactionId ||
      !transactionIds.has(providerObservation.transactionId) ||
      !trueOnly(evidence.independentFulfillmentProofVerified)
    ) {
      return quote('fulfillment_evidence_incomplete_hold');
    }
    return quote('commit_candidate_only', {
      operationKey: opKey(operation),
      ledgerEventKey: opKey(operation) + ':commit',
      providerTransactionId: providerObservation.transactionId,
      providerRoute: outbox.providerRoute,
      payloadDigest: outbox.payloadDigest,
      providerIdempotencyKey: idempotencyKey(operation)
    });
  }
  if (providerObservation.state === 'not_fulfilled') {
    if (
      outcomes.has('succeeded') ||
      !outcomes.has('failed') ||
      !trueOnly(evidence.definitiveNonfulfillmentAndCancellationProven)
    ) {
      return quote('nonfulfillment_evidence_incomplete_hold');
    }
    return quote('release_candidate_only', {
      operationKey: opKey(operation),
      ledgerEventKey: opKey(operation) + ':release',
      providerRoute: outbox.providerRoute,
      payloadDigest: outbox.payloadDigest,
      providerIdempotencyKey: idempotencyKey(operation)
    });
  }
  return quote('unknown_fulfillment_hold');
}

/**
 * A non-executable structural contract for future DB transactions.
 * Existing scout_point_ledger.status values are NOT operation claim phases.
 * Existing event_key unique alone is NOT wallet/budget/outbox atomicity.
 */
export function quoteScoutAtomicResourceContract({
  proposal,
  recheck,
  gate08Design,
  outboxQuote,
  receiptDecision,
  recoveryQuote,
  snapshot,
  capabilities
}) {
  if (
    !object(proposal) ||
    !ACTIONS.has(proposal.action) ||
    proposal.status !== 'proposal_only' ||
    !object(proposal.expectedOperation)
  ) {
    throw new TypeError('Gate07 operation proposal required');
  }
  verifyOperation(proposal.expectedOperation);
  if (
    !object(recheck) ||
    recheck.status !== 'preconditions_match_only' ||
    recheck.operationKey !== proposal.operationKey ||
    recheck.action !== proposal.action ||
    recheck.mayMovePointsOrMoney !== false ||
    !object(gate08Design) ||
    gate08Design.status !== 'connection_design_only' ||
    gate08Design.operationKey !== proposal.operationKey ||
    gate08Design.action !== proposal.action ||
    gate08Design.ledgerEventKey !==
      proposal.operationKey + ':' + proposal.action ||
    gate08Design.mayConnectDb !== false ||
    gate08Design.mayMovePointsOrMoney !== false
  ) {
    return quote('gate07_or_gate08_design_not_aligned');
  }
  if (
    proposal.operationKey !== opKey(proposal.expectedOperation) ||
    proposal.mayMovePointsOrMoney !== false ||
    !object(proposal.nextOperation) ||
    proposal.nextOperation.userId !== proposal.expectedOperation.userId ||
    proposal.nextOperation.operationId !==
      proposal.expectedOperation.operationId ||
    proposal.nextOperation.purpose !== proposal.expectedOperation.purpose ||
    proposal.nextOperation.amountPoints !==
      proposal.expectedOperation.amountPoints
  ) {
    return quote('operation_contract_mismatch');
  }
  if (
    !object(snapshot) ||
    snapshot.operationKey !== proposal.operationKey ||
    snapshot.phase !== proposal.expectedOperation.phase ||
    snapshot.operationRevision !== proposal.expectedOperation.revision ||
    snapshot.walletRevision !== proposal.expectedWallet?.revision ||
    snapshot.budgetRevision !== proposal.expectedBudget?.revision ||
    snapshot.budgetScope !== proposal.expectedBudget?.scopeId ||
    snapshot.userId !== proposal.expectedOperation.userId ||
    snapshot.providerIdempotencyKey !==
      idempotencyKey(proposal.expectedOperation) ||
    !DIGEST.test(snapshot.outboxPayloadDigest) ||
    !EVENT.test(snapshot.providerRoute) ||
    (proposal.action !== 'reserve' &&
      snapshot.outboxOperationKey !== proposal.operationKey)
  ) {
    return quote('snapshot_or_resource_scope_mismatch');
  }
  if (
    !object(capabilities) ||
    REQUIRED_ATOMIC_GUARDS.some((name) => !trueOnly(capabilities[name]))
  ) {
    return quote('durable_atomic_guarantees_unproven', {
      missingRequirements: immutable(
        REQUIRED_ATOMIC_GUARDS.filter((name) => !trueOnly(capabilities?.[name]))
      )
    });
  }
  const action = proposal.action;
  const immutableBinding =
    outboxQuote?.operationKey === proposal.operationKey &&
    outboxQuote?.idempotencyKey === idempotencyKey(proposal.expectedOperation);
  if (action === 'reserve') {
    if (
      proposal.expectedOperation.phase !== 'new' ||
      proposal.nextOperation.phase !== 'reserved' ||
      !object(outboxQuote) ||
      outboxQuote.status !== 'outbox_enqueue_quote_only' ||
      !immutableBinding ||
      !DIGEST.test(outboxQuote.requestFingerprint) ||
      snapshot.outboxPayloadDigest !== outboxQuote.requestFingerprint ||
      snapshot.providerRoute !== outboxQuote.providerRoute ||
      outboxQuote.mayInvokeProvider !== false ||
      snapshot.existingOutbox !== false
    ) {
      return quote('reserve_outbox_claim_not_consistent');
    }
  } else {
    if (snapshot.existingOutbox !== true) {
      return quote('settlement_without_durable_outbox_hold');
    }
    if (action === 'commit' || action === 'release') {
      if (
        !object(receiptDecision) ||
        receiptDecision.status !==
          (action === 'commit'
            ? 'commit_candidate_only'
            : 'release_candidate_only') ||
        receiptDecision.operationKey !== proposal.operationKey ||
        receiptDecision.ledgerEventKey !==
          proposal.operationKey + ':' + action ||
        receiptDecision.payloadDigest !== snapshot.outboxPayloadDigest ||
        receiptDecision.providerRoute !== snapshot.providerRoute ||
        receiptDecision.providerIdempotencyKey !==
          snapshot.providerIdempotencyKey ||
        receiptDecision.maySettle !== false
      ) {
        return quote('provider_reconciliation_not_authoritative');
      }
    } else if (
      action === 'refund' &&
      (!object(recoveryQuote) ||
        recoveryQuote.status !== 'refund_candidate_only' ||
        recoveryQuote.operationId !== proposal.expectedOperation.operationId ||
        recoveryQuote.mayMovePointsOrMoney !== false)
    ) {
      return quote('refund_recovery_evidence_missing');
    }
  }
  return quote('atomic_contract_design_only', {
    operationKey: proposal.operationKey,
    action,
    ledgerEventKey: proposal.operationKey + ':' + action,
    transactionSteps: immutable([
      'server_authenticate_and_reconcile_current_eligible_point_ledger',
      'begin_one_serializable_transaction_with_consistent_retry_policy',
      'lock_shared_wallet_then_budget_scope_then_operation_claim',
      'enforce_claim_unique_and_phase_revision_compare_and_swap',
      'recheck_original_gate07_wallet_budget_claim_revisions_under_locks',
      'reject_duplicate_ledger_event_and_duplicate_reversal_reference',
      'apply_wallet_budget_and_claim_state_only_if_all_invariants_hold',
      'persist_ledger_outbox_and_audit_in_same_commit',
      'commit_transaction_before_any_external_provider_network'
    ]),
    requiresSeparateExternalExecution: true,
    realDatabaseAtomicityProven: false,
    existingLedgerStatusUsableAsClaimPhase: false,
    liveProviderIdempotencyProven: false
  });
}
