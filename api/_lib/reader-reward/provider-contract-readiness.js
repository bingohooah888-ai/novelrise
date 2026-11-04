// Gate 12: provider-contract discovery, finality and OWNER dependency analysis.
// Pure, provider-agnostic, non-executable. No real provider contract is asserted.
// NO DB, network, credit conversion, payout, AI execution or migration.
const COMMON = Object.freeze([
  'provider_identity_and_legal_entity',
  'contract_version_effective_dates_and_change_notice',
  'server_only_authentication_and_account_scope',
  'stable_client_operation_idempotency_key',
  'idempotency_key_retention_vs_maximum_recovery_window',
  'same_key_same_payload_repeat_returns_same_transaction',
  'same_key_different_payload_must_be_rejected',
  'read_only_status_lookup_by_stable_operation_key',
  'status_lookup_consistency_freshness_and_outage_behavior',
  'distinct_pending_final_success_final_failure_states',
  'finality_definition_and_post_final_reversal_window',
  'provider_transaction_id_stable_and_unique_in_scope',
  'webhook_authentication_replay_expiry_and_event_dedupe',
  'out_of_order_duplicate_and_delayed_webhook_contract',
  'timeout_and_unknown_outcome_reconciliation',
  'partial_fulfillment_and_permanent_failure_handling',
  'cancel_before_dispatch_and_cancel_after_acceptance_semantics',
  'post_fulfillment_reversal_clawback_and_dispute_process',
  'receipt_audit_retention_and_personal_data_processing',
  'incident_escalation_contact_and_reconciliation_sla'
]);
const EXCHANGE = Object.freeze([
  'redemption_catalog_and_settlement_currency',
  'exchange_amount_and_fee_deduction_rules',
  'minimum_redemption_supported_or_server_enforced',
  'gift_or_cash_delivery_receipt_and_recipient_binding',
  'provider_funded_balance_and_reserve_limits',
  'anti_money_laundering_identity_and_age_requirements',
  'tax_disclosure_and_jurisdiction_restrictions',
  'failed_delivery_replacement_and_funds_recovery',
  'delivered_but_revoked_reward_resolution'
]);
const AI = Object.freeze([
  'model_version_pricing_and_cost_change_notice',
  'server_verified_price_quote_before_reservation',
  'request_dedupe_vs_duplicate_model_execution',
  'stream_started_partial_output_and_delivery_receipt',
  'per_request_usage_metering_and_charge_finality',
  'timeout_after_tokens_spent_and_uncertain_result',
  'cancellation_after_generation_started',
  'non_delivery_recredit_and_provider_refund_limits',
  'data_retention_training_privacy_and_content_policy'
]);
const DECISIONS = Object.freeze([
  'level31_to_100_xp_thresholds',
  'level100_overflow_xp',
  'fractional_yen_point_settlement',
  'beta_earned_point_spending_eligibility',
  'ai_feature_point_prices',
  'funding_and_redemption_budgets_with_periods',
  'exchange_vendor_fee_and_product_selection',
  'identity_legal_and_tax_approval',
  'formal_launch_and_cutover_date'
]);
const RESOURCES = Object.freeze([
  'eligible_wallet_ledger_reconciliation',
  'shared_wallet_revision_cas',
  'separate_issuance_and_redemption_budget_cas',
  'durable_unique_operation_claim',
  'immutable_unique_transactional_outbox',
  'provider_receipt_and_webhook_dedupe_journal',
  'atomic_wallet_budget_claim_ledger_outbox_audit_commit',
  'privileged_rpc_rls_risk_and_legacy_path_audit',
  'provider_reconciliation_without_unbounded_retries'
]);
const CHANNELS = Object.freeze({
  external_exchange: Object.freeze({
    owner: Object.freeze([
      'fractional_yen_point_settlement',
      'beta_earned_point_spending_eligibility',
      'funding_and_redemption_budgets_with_periods',
      'exchange_vendor_fee_and_product_selection',
      'identity_legal_and_tax_approval',
      'formal_launch_and_cutover_date'
    ]),
    provider: EXCHANGE
  }),
  ai_direct_use: Object.freeze({
    owner: Object.freeze([
      'fractional_yen_point_settlement',
      'beta_earned_point_spending_eligibility',
      'ai_feature_point_prices',
      'funding_and_redemption_budgets_with_periods',
      'formal_launch_and_cutover_date'
    ]),
    provider: AI
  })
});
const ASSERTION_STATES = new Set([
  'unknown',
  'provider_claimed',
  'written_contract_reviewed',
  'isolated_test_observed'
]);
const OWNER_STATES = new Set(['pending', 'approved', 'rejected']);
const RESOURCE_STATES = new Set([
  'not_proven',
  'design_only',
  'catalog_metadata_seen',
  'live_transaction_evidence'
]);
const OUTCOMES = new Set([
  'unknown',
  'pending',
  'provisional_success',
  'final_success',
  'cancel_requested',
  'final_cancelled',
  'final_failed',
  'partial',
  'reversed_after_success'
]);
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const frozen = (v) => Object.freeze(v);
const immutableList = (v) =>
  Object.freeze(v.map((item) => Object.freeze(item)));
const safeString = (v) =>
  typeof v === 'string' && v.length > 0 && v.length <= 160;
const quote = (status, extra = {}) =>
  frozen({
    status,
    ...extra,
    mayConnectDb: false,
    mayInvokeProvider: false,
    mayTransferValue: false,
    mayRunAI: false,
    maySettle: false
  });
function getChannel(value) {
  if (!Object.hasOwn(CHANNELS, value)) {
    throw new TypeError('Known mock use channel required');
  }
  return CHANNELS[value];
}
function requirements(channel) {
  return [...COMMON, ...getChannel(channel).provider];
}
/**
 * Provider has not been selected by the OWNER. Do not fabricate capabilities.
 * Assertion states describe ONLY caller-supplied material; they are not
 * authentication, a signed contract, or verified production capabilities.
 */
export function assessScoutProviderContract({
  channel,
  provider = null,
  assertions = []
}) {
  const spec = getChannel(channel);
  if (
    (provider !== null &&
      (!object(provider) ||
        !safeString(provider.name) ||
        !safeString(provider.contractVersion))) ||
    !Array.isArray(assertions) ||
    assertions.length > 100
  ) {
    throw new TypeError('Provider descriptor or bounded assertions malformed');
  }
  const allowed = new Set(requirements(channel));
  const seen = new Set();
  const accepted = new Map();
  const invalid = [];
  for (const record of assertions) {
    if (
      !object(record) ||
      !allowed.has(record.requirement) ||
      !ASSERTION_STATES.has(record.status) ||
      seen.has(record.requirement)
    ) {
      invalid.push(record?.requirement ?? 'malformed');
      continue;
    }
    seen.add(record.requirement);
    accepted.set(record.requirement, record.status);
  }
  const rows = requirements(channel).map((name) =>
    frozen({
      id: name,
      scope: COMMON.includes(name) ? 'both' : channel,
      evidenceStatus: accepted.get(name) ?? 'unknown',
      requiresProviderContractProof: true
    })
  );
  return quote('contract_requirement_survey_only', {
    channel,
    providerNamed: provider !== null,
    providerLabel: provider?.name ?? null,
    sourceOfEvidence: 'caller_supplied_untrusted_metadata_only',
    requirements: frozen(rows),
    gaps: frozen(
      rows.filter((x) => x.evidenceStatus === 'unknown').map((x) => x.id)
    ),
    inconsistentAssertionIds: frozen(invalid),
    mustObtainSignedContractAndIndependentProof: true,
    requirementCount: rows.length,
    channelSpecificRequirementCount: spec.provider.length,
    liveProviderVerified: false
  });
}

/**
 * Pre-release contract-state lifecycle analysis. Finality evidence only
 * produces a future reconciliation candidate; it never settles a wallet.
 * Local booleans cannot prove that a provider has promised finality.
 */
export function quoteScoutProviderFinalityBoundary({
  channel,
  operation,
  observation,
  history,
  evidence
}) {
  getChannel(channel);
  if (
    !object(operation) ||
    !safeString(operation.operationKey) ||
    operation.channel !== channel ||
    !['new', 'reserved', 'committed', 'released', 'refunded'].includes(
      operation.phase
    ) ||
    !object(observation) ||
    !OUTCOMES.has(observation.outcome) ||
    observation.operationKey !== operation.operationKey ||
    !Array.isArray(history) ||
    history.length > 100
  ) {
    throw new TypeError('Bounded same-operation provider observation required');
  }
  if (
    !object(evidence) ||
    ![
      'authoritativeServerRequest',
      'operationAndImmutablePayloadBound',
      'completeSignedReceiptHistory',
      'freshAuthenticatedProviderReadOnlyStatusQuery',
      'providerFinalityAndReversalContractIndependentlyReviewed',
      'idempotencyRetentionCoversRecoveryHorizon',
      'walletBudgetClaimStateStillLockedAndRechecked'
    ].every((name) => evidence[name] === true)
  ) {
    return quote('provider_boundary_evidence_unproven');
  }
  const transactionIds = new Set();
  const terminal = new Set();
  for (const event of history) {
    if (
      !object(event) ||
      !OUTCOMES.has(event.outcome) ||
      event.operationKey !== operation.operationKey ||
      !safeString(event.eventId) ||
      (![null, undefined].includes(event.transactionId) &&
        !safeString(event.transactionId))
    ) {
      return quote('receipt_history_binding_or_shape_hold');
    }
    if (event.transactionId) transactionIds.add(event.transactionId);
    if (
      ['final_success', 'final_cancelled', 'final_failed'].includes(
        event.outcome
      )
    ) {
      terminal.add(event.outcome);
    }
  }
  if (observation.transactionId && !safeString(observation.transactionId)) {
    return quote('provider_transaction_binding_hold');
  }
  if (observation.transactionId) transactionIds.add(observation.transactionId);
  if (transactionIds.size > 1) {
    return quote('provider_transaction_id_collision_manual_hold');
  }
  if (
    (terminal.has('final_success') &&
      (terminal.has('final_failed') || terminal.has('final_cancelled'))) ||
    (observation.outcome === 'final_success' &&
      (terminal.has('final_failed') || terminal.has('final_cancelled'))) ||
    (['final_failed', 'final_cancelled'].includes(observation.outcome) &&
      terminal.has('final_success'))
  ) {
    return quote('conflicting_final_provider_outcomes_manual_hold');
  }
  if (
    operation.phase === 'committed' ||
    operation.phase === 'released' ||
    operation.phase === 'refunded'
  ) {
    return quote('terminal_local_operation_reconcile_only');
  }
  if (operation.phase !== 'reserved') {
    return quote('unreserved_operation_hold');
  }
  if (
    observation.outcome === 'partial' ||
    history.some((x) => x.outcome === 'partial')
  ) {
    return quote('partial_or_uncertain_delivery_manual_hold');
  }
  if (
    observation.outcome === 'unknown' ||
    observation.outcome === 'pending' ||
    observation.outcome === 'provisional_success' ||
    observation.outcome === 'cancel_requested'
  ) {
    return quote('nonterminal_provider_state_hold');
  }
  if (observation.outcome === 'reversed_after_success') {
    return quote('reversal_and_clawback_manual_hold');
  }
  if (observation.outcome === 'final_success') {
    if (
      evidence.independentFulfillmentProofVerified !== true ||
      !observation.transactionId ||
      !terminal.has('final_success')
    ) {
      return quote('final_fulfillment_not_independently_proven');
    }
    return quote('commit_evidence_candidate_only', {
      operationKey: operation.operationKey,
      providerTransactionId: observation.transactionId
    });
  }
  if (['final_cancelled', 'final_failed'].includes(observation.outcome)) {
    if (
      evidence.definitiveNoFulfillmentProofVerified !== true ||
      !terminal.has(observation.outcome)
    ) {
      return quote('cancel_or_failure_not_finally_proven');
    }
    return quote('release_evidence_candidate_only', {
      operationKey: operation.operationKey,
      providerTransactionId: observation.transactionId ?? null
    });
  }
  return quote('unknown_provider_state_hold');
}

/**
 * Explicit dependency graph: OWNER approvals -> provider contract -> durable
 * resources -> permitted future live-proof gate. Not a runtime readiness
 * check, and not a decision to implement migration or pick a provider.
 */
export function mapScoutRewardDependencies({
  ownerDecisions = {},
  providerContracts = {},
  resources = {}
}) {
  if (
    !object(ownerDecisions) ||
    !object(providerContracts) ||
    !object(resources)
  ) {
    throw new TypeError('Read-only decision and resource snapshots required');
  }
  for (const [key, value] of Object.entries(ownerDecisions)) {
    if (!DECISIONS.includes(key) || !OWNER_STATES.has(value)) {
      throw new TypeError('Unsupported OWNER decision or status');
    }
  }
  for (const [key, value] of Object.entries(resources)) {
    if (!RESOURCES.includes(key) || !RESOURCE_STATES.has(value)) {
      throw new TypeError('Unsupported resource proof status');
    }
  }
  const decisions = immutableList(
    DECISIONS.map((id) => ({
      id,
      authority: 'OWNER',
      status: ownerDecisions[id] ?? 'pending',
      blocksGeneralFormalProgression: [
        'level31_to_100_xp_thresholds',
        'level100_overflow_xp'
      ].includes(id)
    }))
  );
  const resourceNodes = immutableList(
    RESOURCES.map((id) => ({
      id,
      evidenceStatus: resources[id] ?? 'not_proven',
      authority: 'future_DB_design_and_live_proof'
    }))
  );
  const routes = [];
  for (const channel of Object.keys(CHANNELS)) {
    const needed = CHANNELS[channel];
    const provider = providerContracts[channel] ?? null;
    if (
      provider !== null &&
      (!object(provider) ||
        provider.status !== 'contract_requirement_survey_only' ||
        provider.channel !== channel)
    ) {
      throw new TypeError('Unsupported read-only provider assessment');
    }
    const ownerGaps = needed.owner.filter(
      (id) => ownerDecisions[id] !== 'approved'
    );
    const providerGaps =
      provider?.requirements
        ?.filter(
          (x) =>
            x.evidenceStatus !== 'written_contract_reviewed' &&
            x.evidenceStatus !== 'isolated_test_observed'
        )
        .map((x) => x.id) ?? requirements(channel);
    const resourceGaps = RESOURCES.filter(
      (id) => resources[id] !== 'live_transaction_evidence'
    );
    routes.push(
      frozen({
        channel,
        prerequisiteOwnerDecisionIds: frozen([...needed.owner]),
        prerequisiteProviderRequirementIds: frozen(requirements(channel)),
        prerequisiteDurableResourceIds: frozen([...RESOURCES]),
        pendingOwnerDecisionIds: frozen(ownerGaps),
        unverifiedProviderRequirementIds: frozen(providerGaps),
        unverifiedDurableResourceIds: frozen(resourceGaps),
        blockersBeforeLiveProof:
          ownerGaps.length + providerGaps.length + resourceGaps.length,
        // Even an entirely green user-supplied snapshot does NOT authorize use.
        independentlyVerified: false,
        safeForLiveExecution: false
      })
    );
  }
  return quote('owner_contract_resource_dependencies_only', {
    decisions,
    resources: resourceNodes,
    routes: frozen(routes),
    formalProgressionPending: frozen(
      decisions
        .filter(
          (x) => x.blocksGeneralFormalProgression && x.status !== 'approved'
        )
        .map((x) => x.id)
    ),
    crossCuttingFutureGates: frozen([
      'owner_exact_scope_provider_and_legal_acceptance',
      'migration_and_actual_db_atomicity_independent_approval',
      'staging_real_provider_or_test_contract_proof',
      'production_rollout_and_security_approval'
    ]),
    mayPublishRewardRedemption: false
  });
}
