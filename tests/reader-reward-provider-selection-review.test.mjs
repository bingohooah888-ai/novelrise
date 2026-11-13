import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareScoutProviderCriteria,
  prioritizeScoutOwnerDecisionQueue,
  compareScoutPreapprovalRequirements
} from '../api/_lib/reader-reward/provider-selection-review.js';
import {
  assessScoutProviderContract,
  mapScoutRewardDependencies
} from '../api/_lib/reader-reward/provider-contract-readiness.js';

const EX = 'external_exchange';
const AI = 'ai_direct_use';
const candidate = (id, channel = EX, status = 'unknown') => ({
  id,
  name: 'Fixture ' + id,
  contractVersion: 'draft-v1',
  assertions: assessScoutProviderContract({ channel }).requirements.map(
    (x) => ({ requirement: x.id, status })
  )
});
const allOwners = Object.fromEntries(
  mapScoutRewardDependencies({}).decisions.map((d) => [d.id, 'approved'])
);
const allResources = Object.fromEntries(
  mapScoutRewardDependencies({}).resources.map((r) => [
    r.id,
    'live_transaction_evidence'
  ])
);
const denied = (v) => {
  for (const key of [
    'maySelectProvider',
    'mayApproveOwnerDecisions',
    'mayConnectDb',
    'mayInvokeProvider',
    'mayTransferValue',
    'mayRunAI',
    'maySettle',
    'mayPublish'
  ])
    assert.equal(v[key], false, key);
};

test('no candidate means none selected', () => {
  const r = compareScoutProviderCriteria({ channel: EX });
  assert.equal(r.candidateCount, 0);
  assert.equal(r.providerChosen, null);
  denied(r);
});
test('AI uses its own channel requirements', () => {
  const r = compareScoutProviderCriteria({
    channel: AI,
    candidates: [candidate('ai', AI)]
  });
  assert.equal(r.providers[0].requirementCount, 29);
  assert.ok(
    r.providers[0].requirementGaps.includes(
      'per_request_usage_metering_and_charge_finality'
    )
  );
});
test('exchange uses its own channel requirements', () => {
  const r = compareScoutProviderCriteria({
    channel: EX,
    candidates: [candidate('exchange')]
  });
  assert.equal(r.providers[0].requirementCount, 29);
  assert.equal(r.providers[0].criticalContractGaps.length, 14);
  assert.ok(
    r.providers[0].requirementGaps.includes(
      'anti_money_laundering_identity_and_age_requirements'
    )
  );
});
test('self-declared provider claims cannot clear the mandatory list', () => {
  const r = compareScoutProviderCriteria({
    channel: EX,
    candidates: [candidate('vendor', EX, 'provider_claimed')]
  });
  assert.equal(r.providers[0].declaredProviderClaimsCount, 29);
  assert.equal(r.providers[0].criticalContractGaps.length, 14);
  assert.equal(r.providerChosen, null);
  denied(r);
});
test('even 29 written-contract assertions cannot authorize vendor choice', () => {
  const r = compareScoutProviderCriteria({
    channel: EX,
    candidates: [candidate('vendor', EX, 'written_contract_reviewed')]
  });
  assert.equal(r.providers[0].requirementGaps.length, 0);
  assert.equal(r.providers[0].eligibleForSelection, false);
  assert.equal(r.providers[0].score, null);
  denied(r);
});
test('isolation evidence is not real provider contract proof', () => {
  const r = compareScoutProviderCriteria({
    channel: AI,
    candidates: [candidate('ai', AI, 'isolated_test_observed')]
  });
  assert.equal(r.providers[0].serviceCapabilitiesVerified, false);
  assert.equal(
    r.providers[0].providerLegalContractIndependentlyAuthenticated,
    false
  );
});
test('critical finality and idempotency cannot be scored away', () => {
  const c = candidate('vendor', EX, 'written_contract_reviewed');
  c.assertions = c.assertions.map((x) =>
    x.requirement === 'finality_definition_and_post_final_reversal_window' ||
    x.requirement === 'same_key_different_payload_must_be_rejected'
      ? { ...x, status: 'unknown' }
      : x
  );
  const r = compareScoutProviderCriteria({ channel: EX, candidates: [c] });
  assert.equal(r.providers[0].criticalContractGaps.length, 2);
  assert.equal(r.providers[0].eligibleForSelection, false);
});
test('more complete mock documentation does not create a best pick', () => {
  const r = compareScoutProviderCriteria({
    channel: EX,
    candidates: [
      candidate('a'),
      candidate('b', EX, 'written_contract_reviewed')
    ]
  });
  assert.equal(r.providers[0].reviewedOrTestedCount, 0);
  assert.equal(r.providers[1].reviewedOrTestedCount, 29);
  assert.equal(r.providerChosen, null);
  assert.ok(r.providers.every((x) => x.recommendation === null));
});
test('reject duplicated candidate IDs', () => {
  assert.throws(
    () =>
      compareScoutProviderCriteria({
        channel: EX,
        candidates: [candidate('same'), candidate('same')]
      }),
    TypeError
  );
});
test('reject missing vendor labels', () => {
  assert.throws(
    () =>
      compareScoutProviderCriteria({
        channel: EX,
        candidates: [
          { id: '1', name: '', contractVersion: 'v1', assertions: [] }
        ]
      }),
    TypeError
  );
});
test('candidate enumeration is limited to twelve', () => {
  assert.throws(
    () =>
      compareScoutProviderCriteria({
        channel: EX,
        candidates: Array.from({ length: 13 }, (_, i) => candidate('v' + i))
      }),
    TypeError
  );
});
test('unrecognized or duplicated supplier claims are not silently accepted', () => {
  const c = candidate('vendor');
  c.assertions.push({ requirement: 'not_in_contract', status: 'unknown' });
  c.assertions.push(c.assertions[0]);
  const r = compareScoutProviderCriteria({ channel: EX, candidates: [c] });
  assert.equal(r.providers[0].invalidOrDuplicateAssertions.length, 2);
  denied(r);
});
test('OWNER recommendation queue covers nine official decision categories', () => {
  const r = prioritizeScoutOwnerDecisionQueue({});
  assert.equal(r.decisions.length, 9);
  assert.equal(new Set(r.decisions.map((x) => x.id)).size, 9);
  assert.deepEqual(
    r.priorities.map((x) => x.tier),
    [1, 2, 3, 4]
  );
  denied(r);
});
test('value and legal decisions are prioritized over vendor and AI pricing', () => {
  const r = prioritizeScoutOwnerDecisionQueue({});
  assert.deepEqual(r.priorities[0].decisionIds, [
    'beta_earned_point_spending_eligibility',
    'funding_and_redemption_budgets_with_periods',
    'fractional_yen_point_settlement',
    'identity_legal_and_tax_approval'
  ]);
});
test('vendor choice depends on funding, law and beta balances', () => {
  const r = prioritizeScoutOwnerDecisionQueue({});
  const d = r.decisions.find(
    (x) => x.id === 'exchange_vendor_fee_and_product_selection'
  );
  assert.deepEqual(d.pendingDependencyIds, [
    'funding_and_redemption_budgets_with_periods',
    'identity_legal_and_tax_approval',
    'beta_earned_point_spending_eligibility'
  ]);
});
test('AI price decision depends on risk and funding boundaries', () => {
  const r = prioritizeScoutOwnerDecisionQueue({});
  const d = r.decisions.find((x) => x.id === 'ai_feature_point_prices');
  assert.ok(
    d.pendingDependencyIds.includes('beta_earned_point_spending_eligibility')
  );
  assert.ok(
    d.pendingDependencyIds.includes(
      'funding_and_redemption_budgets_with_periods'
    )
  );
});
test('level100 overflow is sequenced after level thresholds', () => {
  const r = prioritizeScoutOwnerDecisionQueue({});
  assert.deepEqual(
    r.decisions.find((x) => x.id === 'level100_overflow_xp')
      .pendingDependencyIds,
    ['level31_to_100_xp_thresholds']
  );
});
test('formal launch cutover is the last advisory tier', () => {
  const r = prioritizeScoutOwnerDecisionQueue({});
  const d = r.decisions.find((x) => x.id === 'formal_launch_and_cutover_date');
  assert.equal(d.advisoryPriorityTier, 4);
  assert.ok(d.pendingDependencyIds.includes('ai_feature_point_prices'));
  assert.equal(d.mayTreatAsOwnerApproved, false);
});
test('approved, pending and rejected preserve their distinct meanings', () => {
  const r = prioritizeScoutOwnerDecisionQueue({
    ownerDecisions: {
      beta_earned_point_spending_eligibility: 'approved',
      identity_legal_and_tax_approval: 'rejected'
    }
  });
  assert.ok(
    !r.pendingDecisionIds.includes('beta_earned_point_spending_eligibility')
  );
  assert.ok(r.pendingDecisionIds.includes('identity_legal_and_tax_approval'));
});
test('all nine hypothetical approvals do not authorize execution', () => {
  const r = prioritizeScoutOwnerDecisionQueue({ ownerDecisions: allOwners });
  assert.equal(r.pendingDecisionIds.length, 0);
  assert.equal(r.priorityOrderIsNotAnOwnerApproval, true);
  denied(r);
});
test('unknown decision and fabricated status fail closed', () => {
  assert.throws(
    () =>
      prioritizeScoutOwnerDecisionQueue({
        ownerDecisions: { decision_x: 'approved' }
      }),
    TypeError
  );
  assert.throws(
    () =>
      prioritizeScoutOwnerDecisionQueue({
        ownerDecisions: { ai_feature_point_prices: 'assumed' }
      }),
    TypeError
  );
});
test('empty preapproval checklist remains blocked and unreleased', () => {
  const r = compareScoutPreapprovalRequirements({ channel: EX });
  assert.deepEqual(
    r.checklist.map((x) => x.status),
    ['blocked', 'blocked', 'blocked', 'not_performed']
  );
  assert.equal(r.viableProviderSelected, null);
  denied(r);
});
test('owner declared approved does not imply provider contract readiness', () => {
  const r = compareScoutPreapprovalRequirements({
    channel: EX,
    ownerDecisions: allOwners
  });
  assert.equal(r.checklist[0].status, 'self_declared_complete');
  assert.equal(r.checklist[1].status, 'blocked');
  denied(r);
});
test('provider self claims do not satisfy nonnegotiable terms', () => {
  const r = compareScoutPreapprovalRequirements({
    channel: EX,
    candidates: [candidate('vendor', EX, 'provider_claimed')]
  });
  assert.equal(r.checklist[1].status, 'blocked');
});
test('metadata-only DB evidence does not prove atomicity', () => {
  const r = compareScoutPreapprovalRequirements({
    channel: EX,
    resources: { durable_unique_operation_claim: 'catalog_metadata_seen' }
  });
  assert.ok(r.resourceGaps.includes('durable_unique_operation_claim'));
});
test('XP progression is separate from AI direct spending blockers', () => {
  const r = compareScoutPreapprovalRequirements({ channel: AI });
  assert.ok(
    r.owners.pendingDecisionIds.includes('level31_to_100_xp_thresholds')
  );
  assert.ok(
    !r.checklist[0].outstandingIds.includes('level31_to_100_xp_thresholds')
  );
});
test('exchange decisions do not solve AI prices', () => {
  const r = compareScoutPreapprovalRequirements({
    channel: AI,
    ownerDecisions: {
      exchange_vendor_fee_and_product_selection: 'approved'
    }
  });
  assert.ok(r.checklist[0].outstandingIds.includes('ai_feature_point_prices'));
});
test('mock documented supplier terms still provide no independent live evidence', () => {
  const r = compareScoutPreapprovalRequirements({
    channel: EX,
    candidates: [candidate('vendor', EX, 'written_contract_reviewed')]
  });
  assert.equal(r.checklist[1].status, 'caller_claims_only');
  assert.equal(r.independentEvidenceEstablished, false);
  denied(r);
});
test('even fully green mock snapshots do not bypass Staging or Production approval', () => {
  const r = compareScoutPreapprovalRequirements({
    channel: AI,
    candidates: [candidate('ai', AI, 'isolated_test_observed')],
    ownerDecisions: allOwners,
    resources: allResources
  });
  assert.deepEqual(
    r.checklist.map((x) => x.status),
    [
      'self_declared_complete',
      'caller_claims_only',
      'self_declared_complete',
      'not_performed'
    ]
  );
  assert.equal(r.viableProviderSelected, null);
  denied(r);
});
test('unknown channel and invalid resource states fail closed', () => {
  assert.throws(
    () =>
      compareScoutPreapprovalRequirements({
        channel: 'other_channel'
      }),
    TypeError
  );
  assert.throws(
    () =>
      compareScoutPreapprovalRequirements({
        channel: AI,
        resources: { shared_wallet_revision_cas: 'approved' }
      }),
    TypeError
  );
});
test('live-proof and security gates are always distinct and unresolved', () => {
  const r = compareScoutPreapprovalRequirements({ channel: EX });
  assert.equal(r.lastGate, 'separate_independent_approvals_and_live_proof');
  assert.ok(
    r.checklist[3].outstandingIds.includes(
      'production_rollout_and_security_approval'
    )
  );
});
test('comparison results are immutable to avoid accidental selection', () => {
  const r = compareScoutPreapprovalRequirements({
    channel: EX,
    candidates: [candidate('vendor')]
  });
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.vendors.providers));
  assert.ok(Object.isFrozen(r.checklist[0]));
  assert.throws(() => {
    r.viableProviderSelected = 'vendor';
  }, TypeError);
});
