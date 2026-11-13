import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessScoutProviderContract,
  quoteScoutProviderFinalityBoundary,
  mapScoutRewardDependencies
} from '../api/_lib/reader-reward/provider-contract-readiness.js';

const EXCHANGE = 'external_exchange';
const AI = 'ai_direct_use';
const KEY = 'scout-point-use-v1:test-user:test-operation';
const OP = { operationKey: KEY, channel: EXCHANGE, phase: 'reserved' };
const baseEvidence = () => ({
  authoritativeServerRequest: true,
  operationAndImmutablePayloadBound: true,
  completeSignedReceiptHistory: true,
  freshAuthenticatedProviderReadOnlyStatusQuery: true,
  providerFinalityAndReversalContractIndependentlyReviewed: true,
  idempotencyRetentionCoversRecoveryHorizon: true,
  walletBudgetClaimStateStillLockedAndRechecked: true,
  independentFulfillmentProofVerified: true,
  definitiveNoFulfillmentProofVerified: true
});
const event = (outcome, overrides = {}) => ({
  eventId: 'evt_001',
  operationKey: KEY,
  transactionId: 'tx_001',
  outcome,
  ...overrides
});
const observation = (outcome, overrides = {}) => ({
  operationKey: KEY,
  transactionId: 'tx_001',
  outcome,
  ...overrides
});
const trial = (overrides = {}) =>
  quoteScoutProviderFinalityBoundary({
    channel: EXCHANGE,
    operation: OP,
    observation: observation('final_success'),
    history: [event('final_success')],
    evidence: baseEvidence(),
    ...overrides
  });
const noExecution = (v) => {
  assert.equal(v.mayConnectDb, false);
  assert.equal(v.mayInvokeProvider, false);
  assert.equal(v.mayTransferValue, false);
  assert.equal(v.mayRunAI, false);
  assert.equal(v.maySettle, false);
};
const reqs = (channel) => assessScoutProviderContract({ channel });
const allClaims = (channel, status = 'written_contract_reviewed') =>
  reqs(channel).requirements.map(({ id }) => ({
    requirement: id,
    status
  }));

test('unknown exchange provider produces only a read-only 29-item requirement survey', () => {
  const v = reqs(EXCHANGE);
  assert.equal(v.status, 'contract_requirement_survey_only');
  assert.equal(v.providerNamed, false);
  assert.equal(v.requirementCount, 29);
  assert.equal(v.channelSpecificRequirementCount, 9);
  assert.equal(v.gaps.length, 29);
  assert.equal(v.liveProviderVerified, false);
  noExecution(v);
});
test('unknown AI provider yields the separate 29-item model and usage requirements', () => {
  const v = reqs(AI);
  assert.equal(v.requirementCount, 29);
  assert.equal(v.channelSpecificRequirementCount, 9);
  assert.ok(
    v.requirements.some(
      (x) => x.id === 'timeout_after_tokens_spent_and_uncertain_result'
    )
  );
  assert.ok(
    v.requirements.some(
      (x) => x.id === 'per_request_usage_metering_and_charge_finality'
    )
  );
  assert.ok(
    !v.requirements.some(
      (x) => x.id === 'anti_money_laundering_identity_and_age_requirements'
    )
  );
});
test('provider-specific exchange rules include 3000pt enforcement and KYC/legal expectations', () => {
  const v = reqs(EXCHANGE);
  assert.ok(
    v.requirements.some(
      (x) => x.id === 'minimum_redemption_supported_or_server_enforced'
    )
  );
  assert.ok(
    v.requirements.some(
      (x) => x.id === 'anti_money_laundering_identity_and_age_requirements'
    )
  );
  assert.ok(
    v.requirements.some(
      (x) => x.id === 'tax_disclosure_and_jurisdiction_restrictions'
    )
  );
});
test('every channel requires finite idempotency retention and finality/reversal rules', () => {
  for (const channel of [EXCHANGE, AI]) {
    const ids = reqs(channel).requirements.map((x) => x.id);
    assert.ok(
      ids.includes('idempotency_key_retention_vs_maximum_recovery_window')
    );
    assert.ok(
      ids.includes('finality_definition_and_post_final_reversal_window')
    );
    assert.ok(ids.includes('read_only_status_lookup_by_stable_operation_key'));
    assert.ok(ids.includes('same_key_different_payload_must_be_rejected'));
  }
});
test('provider label is optional and does not imply signed contract or capability', () => {
  const v = assessScoutProviderContract({
    channel: EXCHANGE,
    provider: { name: 'Hypothetical supplier', contractVersion: 'draft-v1' }
  });
  assert.equal(v.providerNamed, true);
  assert.equal(v.liveProviderVerified, false);
  assert.equal(v.gaps.length, 29);
  noExecution(v);
});
test('a provider self-claim does not satisfy the written contract requirement', () => {
  const v = assessScoutProviderContract({
    channel: AI,
    assertions: [
      {
        requirement: 'request_dedupe_vs_duplicate_model_execution',
        status: 'provider_claimed'
      }
    ]
  });
  assert.equal(
    v.requirements.find(
      (x) => x.id === 'request_dedupe_vs_duplicate_model_execution'
    ).evidenceStatus,
    'provider_claimed'
  );
  assert.equal(v.sourceOfEvidence, 'caller_supplied_untrusted_metadata_only');
  noExecution(v);
});
test('written-claim or isolated-test fixtures cannot activate a provider', () => {
  for (const status of [
    'written_contract_reviewed',
    'isolated_test_observed'
  ]) {
    const v = assessScoutProviderContract({
      channel: EXCHANGE,
      assertions: allClaims(EXCHANGE, status)
    });
    assert.equal(v.gaps.length, 0);
    assert.equal(v.liveProviderVerified, false);
    assert.equal(v.mustObtainSignedContractAndIndependentProof, true);
    noExecution(v);
  }
});
test('contradictory requirement assertions are surfaced, not silently overwritten', () => {
  const req = 'stable_client_operation_idempotency_key';
  const v = assessScoutProviderContract({
    channel: AI,
    assertions: [
      { requirement: req, status: 'provider_claimed' },
      { requirement: req, status: 'isolated_test_observed' }
    ]
  });
  assert.deepEqual(v.inconsistentAssertionIds, [req]);
  assert.equal(
    v.requirements.find((x) => x.id === req).evidenceStatus,
    'provider_claimed'
  );
});
test('unknown or cross-channel assertion IDs must not masquerade as capabilities', () => {
  const v = assessScoutProviderContract({
    channel: AI,
    assertions: [
      {
        requirement: 'tax_disclosure_and_jurisdiction_restrictions',
        status: 'isolated_test_observed'
      }
    ]
  });
  assert.equal(v.inconsistentAssertionIds.length, 1);
  assert.equal(v.gaps.length, 29);
});
test('invalid channels, provider metadata or unbounded assertions fail closed', () => {
  assert.throws(() => reqs('custom_provider'), TypeError);
  assert.throws(
    () =>
      assessScoutProviderContract({
        channel: EXCHANGE,
        provider: { name: 'Unknown' }
      }),
    TypeError
  );
  assert.throws(
    () =>
      assessScoutProviderContract({
        channel: AI,
        assertions: Array.from({ length: 101 }, () => ({}))
      }),
    TypeError
  );
});
test('a reviewed final provider success yields only a non-executable evidence candidate', () => {
  const r = trial();
  assert.equal(r.status, 'commit_evidence_candidate_only');
  assert.equal(r.providerTransactionId, 'tx_001');
  assert.equal(r.operationKey, KEY);
  noExecution(r);
});
test('unknown, pending, provisional success and cancel requested never settle', () => {
  for (const outcome of [
    'unknown',
    'pending',
    'provisional_success',
    'cancel_requested'
  ]) {
    const r = trial({ observation: observation(outcome) });
    assert.equal(r.status, 'nonterminal_provider_state_hold', outcome);
    noExecution(r);
  }
});
test('partial success and partial receipts require manual reconciliation', () => {
  assert.equal(
    trial({ observation: observation('partial') }).status,
    'partial_or_uncertain_delivery_manual_hold'
  );
  assert.equal(
    trial({ history: [event('partial')] }).status,
    'partial_or_uncertain_delivery_manual_hold'
  );
});
test('reversal after apparent success requires clawback review', () => {
  assert.equal(
    trial({ observation: observation('reversed_after_success') }).status,
    'reversal_and_clawback_manual_hold'
  );
});
test('idempotency retention, finality, status query, CAS and source binding are independent', () => {
  for (const name of [
    'authoritativeServerRequest',
    'operationAndImmutablePayloadBound',
    'completeSignedReceiptHistory',
    'freshAuthenticatedProviderReadOnlyStatusQuery',
    'providerFinalityAndReversalContractIndependentlyReviewed',
    'idempotencyRetentionCoversRecoveryHorizon',
    'walletBudgetClaimStateStillLockedAndRechecked'
  ]) {
    assert.equal(
      trial({
        evidence: { ...baseEvidence(), [name]: false }
      }).status,
      'provider_boundary_evidence_unproven',
      name
    );
  }
});
test('final success without independent delivery evidence remains on hold', () => {
  assert.equal(
    trial({
      evidence: {
        ...baseEvidence(),
        independentFulfillmentProofVerified: false
      }
    }).status,
    'final_fulfillment_not_independently_proven'
  );
});
test('no corroborating final receipt prevents payment even if status lookup says final', () => {
  const r = trial({ history: [event('pending')] });
  assert.equal(r.status, 'final_fulfillment_not_independently_proven');
});
test('different provider transaction IDs from history and lookup are held', () => {
  const r = trial({
    observation: observation('final_success', { transactionId: 'tx_002' })
  });
  assert.equal(r.status, 'provider_transaction_id_collision_manual_hold');
});
test('two different provider transaction IDs in receipt history are held', () => {
  const r = trial({
    history: [
      event('final_success'),
      event('final_success', { eventId: 'evt_002', transactionId: 'tx_002' })
    ]
  });
  assert.equal(r.status, 'provider_transaction_id_collision_manual_hold');
});
test('success and final failure callbacks from same provider transaction conflict', () => {
  const r = trial({
    history: [
      event('final_success'),
      event('final_failed', { eventId: 'evt_002' })
    ]
  });
  assert.equal(r.status, 'conflicting_final_provider_outcomes_manual_hold');
});
test('final status observation cannot override contradictory terminal history', () => {
  assert.equal(
    trial({
      observation: observation('final_cancelled')
    }).status,
    'conflicting_final_provider_outcomes_manual_hold'
  );
});
test('cancel requested does not prove cancellation or release available points', () => {
  const r = trial({
    observation: observation('cancel_requested'),
    history: [event('pending')]
  });
  assert.equal(r.status, 'nonterminal_provider_state_hold');
});
test('provider-confirmed final cancellation needs an independent no-fulfillment proof', () => {
  const r = trial({
    observation: observation('final_cancelled', { transactionId: null }),
    history: [event('final_cancelled', { transactionId: null })]
  });
  assert.equal(r.status, 'release_evidence_candidate_only');
  noExecution(r);
});
test('missing definitive no-fulfillment evidence blocks final cancellation release', () => {
  const r = trial({
    observation: observation('final_cancelled'),
    history: [event('final_cancelled')],
    evidence: {
      ...baseEvidence(),
      definitiveNoFulfillmentProofVerified: false
    }
  });
  assert.equal(r.status, 'cancel_or_failure_not_finally_proven');
});
test('final failure must be present in independently checked receipt history', () => {
  const r = trial({
    observation: observation('final_failed'),
    history: [event('pending')]
  });
  assert.equal(r.status, 'cancel_or_failure_not_finally_proven');
});
test('final failed plus final matching receipt yields release evidence candidate only', () => {
  const r = trial({
    observation: observation('final_failed'),
    history: [event('final_failed')]
  });
  assert.equal(r.status, 'release_evidence_candidate_only');
  noExecution(r);
});
test('once wallet is committed/released/refunded no evidence can produce new settlement', () => {
  for (const phase of ['committed', 'released', 'refunded']) {
    const r = trial({ operation: { ...OP, phase } });
    assert.equal(r.status, 'terminal_local_operation_reconcile_only', phase);
  }
});
test('an unreserved wallet is never sent to provider or settled', () => {
  assert.equal(
    trial({
      operation: { ...OP, phase: 'new' }
    }).status,
    'unreserved_operation_hold'
  );
});
test('malformed or cross-operation receipt history is rejected', () => {
  assert.equal(
    trial({ history: [event('final_success', { operationKey: 'wrong' })] })
      .status,
    'receipt_history_binding_or_shape_hold'
  );
  assert.throws(
    () =>
      trial({
        history: Array.from({ length: 101 }, () => event('pending'))
      }),
    TypeError
  );
});
test('wrong operation binding and unsupported outcome must fail early', () => {
  assert.throws(
    () =>
      trial({
        observation: observation('pending', { operationKey: 'other' })
      }),
    TypeError
  );
  assert.throws(
    () =>
      trial({
        observation: observation('not_a_provider_state')
      }),
    TypeError
  );
});
test('dependency matrix identifies all nine owner policy categories', () => {
  const r = mapScoutRewardDependencies({});
  assert.equal(r.decisions.length, 9);
  assert.equal(r.resources.length, 9);
  assert.equal(r.routes.length, 2);
  assert.equal(r.status, 'owner_contract_resource_dependencies_only');
  noExecution(r);
});
test('XP thresholds and Lv100 overflow are tracked separately from direct point usage gates', () => {
  const r = mapScoutRewardDependencies({});
  assert.deepEqual(r.formalProgressionPending, [
    'level31_to_100_xp_thresholds',
    'level100_overflow_xp'
  ]);
  assert.ok(
    !r.routes[0].prerequisiteOwnerDecisionIds.includes(
      'level31_to_100_xp_thresholds'
    )
  );
  assert.ok(
    !r.routes[1].prerequisiteOwnerDecisionIds.includes('level100_overflow_xp')
  );
});
test('AI and exchange have distinct owner preconditions', () => {
  const r = mapScoutRewardDependencies({});
  const ex = r.routes.find((x) => x.channel === EXCHANGE);
  const ai = r.routes.find((x) => x.channel === AI);
  assert.ok(
    ex.prerequisiteOwnerDecisionIds.includes(
      'exchange_vendor_fee_and_product_selection'
    )
  );
  assert.ok(
    !ai.prerequisiteOwnerDecisionIds.includes(
      'exchange_vendor_fee_and_product_selection'
    )
  );
  assert.ok(
    ai.prerequisiteOwnerDecisionIds.includes('ai_feature_point_prices')
  );
  assert.ok(
    !ex.prerequisiteOwnerDecisionIds.includes('ai_feature_point_prices')
  );
});
test('unknown beta points eligibility prevents both route readiness models', () => {
  const r = mapScoutRewardDependencies({});
  for (const route of r.routes) {
    assert.ok(
      route.pendingOwnerDecisionIds.includes(
        'beta_earned_point_spending_eligibility'
      )
    );
    assert.equal(route.safeForLiveExecution, false);
  }
});
test('exchange-only decisions being approved cannot unblock unapproved AI pricing', () => {
  const r = mapScoutRewardDependencies({
    ownerDecisions: {
      exchange_vendor_fee_and_product_selection: 'approved',
      identity_legal_and_tax_approval: 'approved'
    }
  });
  assert.ok(
    r.routes
      .find((x) => x.channel === AI)
      .pendingOwnerDecisionIds.includes('ai_feature_point_prices')
  );
});
test('positive provider self claims do not clear written contract preconditions', () => {
  const doc = assessScoutProviderContract({
    channel: EXCHANGE,
    assertions: allClaims(EXCHANGE, 'provider_claimed')
  });
  const r = mapScoutRewardDependencies({
    providerContracts: { [EXCHANGE]: doc }
  });
  assert.equal(
    r.routes.find((x) => x.channel === EXCHANGE)
      .unverifiedProviderRequirementIds.length,
    29
  );
});
test('metadata-only DB evidence does not count as atomic live DB proof', () => {
  const r = mapScoutRewardDependencies({
    resources: { durable_unique_operation_claim: 'catalog_metadata_seen' }
  });
  assert.ok(
    r.routes.every((x) =>
      x.unverifiedDurableResourceIds.includes('durable_unique_operation_claim')
    )
  );
});
test('a hypothetical fully approved owner/contract/resource snapshot still cannot invoke live services', () => {
  const owner = Object.fromEntries(
    mapScoutRewardDependencies({}).decisions.map((x) => [x.id, 'approved'])
  );
  const resources = Object.fromEntries(
    mapScoutRewardDependencies({}).resources.map((x) => [
      x.id,
      'live_transaction_evidence'
    ])
  );
  const contracts = Object.fromEntries(
    [EXCHANGE, AI].map((channel) => [
      channel,
      assessScoutProviderContract({
        channel,
        assertions: allClaims(channel, 'written_contract_reviewed')
      })
    ])
  );
  const r = mapScoutRewardDependencies({
    ownerDecisions: owner,
    resources,
    providerContracts: contracts
  });
  assert.ok(r.routes.every((x) => x.blockersBeforeLiveProof === 0));
  assert.ok(r.routes.every((x) => x.independentlyVerified === false));
  assert.ok(r.routes.every((x) => x.safeForLiveExecution === false));
  assert.equal(r.mayPublishRewardRedemption, false);
  noExecution(r);
});
test('unknown owner decisions, invalid resource statuses or foreign provider reports cannot be reused', () => {
  assert.throws(
    () =>
      mapScoutRewardDependencies({
        ownerDecisions: { approve_everything: 'approved' }
      }),
    TypeError
  );
  assert.throws(
    () =>
      mapScoutRewardDependencies({
        resources: { shared_wallet_revision_cas: 'maybe' }
      }),
    TypeError
  );
  assert.throws(
    () =>
      mapScoutRewardDependencies({
        providerContracts: { [EXCHANGE]: reqs(AI) }
      }),
    TypeError
  );
});
test('the dependency matrix never implies permission for migrations or production rollout', () => {
  const r = mapScoutRewardDependencies({});
  assert.ok(
    r.crossCuttingFutureGates.includes(
      'migration_and_actual_db_atomicity_independent_approval'
    )
  );
  assert.ok(
    r.crossCuttingFutureGates.includes(
      'production_rollout_and_security_approval'
    )
  );
  noExecution(r);
});
test('returns immutable read-only requirement and dependency structures', () => {
  const v = reqs(AI);
  const r = mapScoutRewardDependencies({});
  assert.equal(Object.isFrozen(v.requirements), true);
  assert.equal(Object.isFrozen(v.requirements[0]), true);
  assert.equal(Object.isFrozen(r.routes), true);
  assert.equal(Object.isFrozen(r.resources[0]), true);
});
