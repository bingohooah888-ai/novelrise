// Gate 08: DB-connection protocol, idempotency, and recovery DESIGN ONLY.
// No SQL, schema migrations, DB connection, external calls, or point movement.
const REQUIRED_LEDGER_COLUMNS = Object.freeze([
  'id',
  'user_id',
  'point_kind',
  'point_value',
  'status',
  'event_key',
  'reversal_of',
  'occurred_at'
]);
const REQUIRED_CONTROL_COLUMNS = Object.freeze([
  'user_id',
  'earning_suspended_until',
  'reason'
]);
const REQUIRED_AUDIT_COLUMNS = Object.freeze([
  'id',
  'user_id',
  'ledger_id',
  'action',
  'created_at'
]);
const ACTIONS = new Set(['reserve', 'commit', 'release', 'refund']);
const PHASES = new Set(['new', 'reserved', 'committed', 'released', 'refunded']);
const OUTCOMES = new Set([
  'unknown',
  'pending',
  'fulfilled',
  'not_fulfilled',
  'partially_fulfilled',
  'refunded'
]);

const frozen = (value) => Object.freeze(value);
const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const verified = (value) => value === true;

function hasColumns(table, required) {
  return (
    object(table) &&
    Array.isArray(table.columns) &&
    required.every((name) => table.columns.includes(name))
  );
}
function uniqueKeyPresent(keys, tableName, columns) {
  return keys.some(
    (entry) =>
      object(entry) &&
      entry.tableName === tableName &&
      Array.isArray(entry.columns) &&
      entry.columns.length === columns.length &&
      columns.every((column, index) => entry.columns[index] === column)
  );
}

/**
 * Audit metadata from existing Scout tables, not fabricated new schema.
 * A migration-file snapshot is NOT live DB attestation. Future durable
 * wallet / budget / operation claims cannot be assumed to exist here.
 */
export function auditScoutPointConnectionSurface(metadata) {
  if (
    !object(metadata) ||
    !object(metadata.tables) ||
    !Array.isArray(metadata.uniqueKeys)
  ) {
    throw new TypeError('Read-only schema metadata is required');
  }
  const blockers = [];
  const tables = metadata.tables;
  for (const [name, columns] of [
    ['scout_point_ledger', REQUIRED_LEDGER_COLUMNS],
    ['scout_point_user_controls', REQUIRED_CONTROL_COLUMNS],
    ['scout_point_operator_actions', REQUIRED_AUDIT_COLUMNS]
  ]) {
    if (!hasColumns(tables[name], columns)) {
      blockers.push('missing_columns:' + name);
    }
    if (tables[name]?.rlsEnabled !== true) {
      blockers.push('rls_unverified:' + name);
    }
  }
  if (
    !uniqueKeyPresent(metadata.uniqueKeys, 'scout_point_ledger', [
      'event_key'
    ])
  ) {
    blockers.push('event_key_uniqueness_unverified');
  }
  if (
    !uniqueKeyPresent(metadata.uniqueKeys, 'scout_point_ledger', [
      'reversal_of'
    ])
  ) {
    blockers.push('one_reversal_per_original_unverified');
  }
  // Existing controls suspend EARNING, not all spending or payouts.
  blockers.push('spending_freeze_and_identity_policy_not_proven');
  blockers.push('durable_operation_reservation_claim_not_proven');
  blockers.push('shared_wallet_revision_cas_not_proven');
  blockers.push('approved_budget_revision_cas_not_proven');
  blockers.push('atomic_outbox_and_provider_idempotency_not_proven');
  blockers.push('live_ledger_and_beta_point_eligibility_not_proven');
  return frozen({
    status: 'preconnection_audit_only',
    reusable: frozen({
      pointLedger: hasColumns(tables.scout_point_ledger, REQUIRED_LEDGER_COLUMNS),
      existingEventKeyUnique: uniqueKeyPresent(
        metadata.uniqueKeys,
        'scout_point_ledger',
        ['event_key']
      ),
      pointRls: tables.scout_point_ledger?.rlsEnabled === true,
      reversalReference:
        tables.scout_point_ledger?.columns?.includes('reversal_of') === true,
      operatorAudit: hasColumns(
        tables.scout_point_operator_actions,
        REQUIRED_AUDIT_COLUMNS
      )
    }),
    blockers: frozen(blockers),
    mayConnectDb: false,
    mayMovePointsOrMoney: false
  });
}

const REQUIRED_GUARDS = Object.freeze([
  'trustedServerPrincipal',
  'fullLedgerReconciliation',
  'pointEligibilityPolicyApproved',
  'identityAndRiskCleared',
  'budgetPolicyApproved',
  'singleTransactionGuaranteed',
  'sharedWalletLockAndCas',
  'budgetLockAndCas',
  'durableOperationClaimUnique',
  'operationRevisionCas',
  'eventKeyUniqueAndReversalSafe',
  'atomicAuditAndOutbox',
  'legacyPointPathsSerialized'
]);

/**
 * Connection choreography only; a Gate 07 recheck is NOT a DB lock.
 * Order all locks consistently: wallet -> budget -> operation claim.
 * Reserve transaction commits BEFORE any provider call. A later, separate
 * settlement transaction commits/reverses after independently verified proof.
 */
export function quoteScoutPointAtomicConnection({
  proposal,
  recheck,
  safeguards
}) {
  if (
    !object(proposal) ||
    !object(proposal.expectedOperation) ||
    !ACTIONS.has(proposal.action)
  ) {
    throw new TypeError('Gate 07 operation proposal is required');
  }
  if (
    proposal.status !== 'proposal_only' ||
    !object(recheck) ||
    recheck.status !== 'preconditions_match_only' ||
    recheck.action !== proposal.action ||
    recheck.operationKey !== proposal.operationKey ||
    recheck.mayMovePointsOrMoney !== false
  ) {
    return frozen({ status: 'gate07_preconditions_not_proven' });
  }
  if (
    !object(safeguards) ||
    REQUIRED_GUARDS.some((name) => !verified(safeguards[name]))
  ) {
    return frozen({ status: 'atomic_safeguards_incomplete' });
  }
  const operation = proposal.expectedOperation;
  const eventKey = proposal.operationKey + ':' + proposal.action;
  if (
    operation.userId !== proposal.expectedWallet?.userId ||
    eventKey.length > 240 ||
    proposal.mayMovePointsOrMoney !== false
  ) {
    return frozen({ status: 'operation_contract_mismatch' });
  }
  return frozen({
    status: 'connection_design_only',
    operationKey: proposal.operationKey,
    ledgerEventKey: eventKey,
    action: proposal.action,
    transactionSteps: frozen([
      'authenticate_and_reconcile_authoritative_ledger',
      'lock_wallet_then_budget_then_operation_claim',
      'enforce_unique_operation_claim_and_event_key',
      'recheck_gate07_quote_and_revisions_under_locks',
      'persist_wallet_budget_operation_ledger_and_audit_atomically',
      'enqueue_idempotent_outbox_inside_same_transaction',
      'commit_before_any_external_provider_call'
    ]),
    // Every phase uses a separate atomic DB transaction. External delivery
    // happens outside it, with provider idempotency and reconciliation.
    externalExecutionInsideTransaction: false,
    mayConnectDb: false,
    mayMovePointsOrMoney: false
  });
}

/**
 * Recovery rules for retries, timeouts, disconnects, duplicate callbacks
 * and partially observed external outcomes. Never auto-retry a provider.
 * No candidate below is authorized to change a real wallet.
 */
export function quoteScoutPointRecovery({
  operation,
  observation,
  evidence
}) {
  if (
    !object(operation) ||
    !PHASES.has(operation.phase) ||
    !['external_exchange', 'ai_direct_use'].includes(operation.purpose) ||
    !object(observation) ||
    !OUTCOMES.has(observation.outcome)
  ) {
    throw new TypeError('Operation and provider outcome must be identified');
  }
  const result = (status) =>
    frozen({
      status,
      operationId: operation.operationId,
      mayRetryExternal: false,
      mayMovePointsOrMoney: false
    });
  if (
    !object(evidence) ||
    !verified(evidence.authoritativeOperationSnapshot) ||
    !verified(evidence.ownerAndProviderIdentityVerified) ||
    !verified(evidence.originalClaimVerified) ||
    !verified(evidence.notificationHistoryComplete)
  ) {
    return result('recovery_evidence_incomplete');
  }
  if (operation.phase === 'released' || operation.phase === 'refunded') {
    return result('terminal_noop');
  }
  if (operation.phase === 'new') {
    return result('missing_reservation_hold');
  }
  if (evidence.duplicateNotification === true) {
    // Duplicate notification may arrive BEFORE the settlement tx committed.
    // Check the durable phase and event key, never silently skip settlement.
    return result('duplicate_notification_reconcile');
  }
  if (observation.outcome === 'partially_fulfilled') {
    return result('partial_fulfillment_manual_reconcile');
  }
  if (
    observation.outcome === 'unknown' ||
    observation.outcome === 'pending'
  ) {
    return result('hold_pending_authoritative_reconciliation');
  }
  if (operation.phase === 'committed') {
    if (
      observation.outcome === 'refunded' &&
      verified(evidence.reversalProofVerified) &&
      (operation.purpose !== 'external_exchange' ||
        verified(evidence.externalFundsRecovered))
    ) {
      return result('refund_candidate_only');
    }
    return result('committed_no_automatic_refund');
  }
  if (
    observation.outcome === 'fulfilled' &&
    verified(evidence.fulfillmentReceiptVerified)
  ) {
    return result('commit_candidate_only');
  }
  if (
    observation.outcome === 'not_fulfilled' &&
    verified(evidence.noFulfillmentProofVerified)
  ) {
    return result('release_candidate_only');
  }
  return result('hold_pending_authoritative_reconciliation');
}
