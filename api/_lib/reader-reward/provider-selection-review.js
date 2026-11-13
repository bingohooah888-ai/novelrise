// Gate 13: vendor selection criteria and OWNER decision sequencing.
// Non-executable and provider-neutral. All candidate statements are untrusted.
// No provider selected, no API, DB, payment, AI execution, migration, or release.
import {
  assessScoutProviderContract,
  mapScoutRewardDependencies
} from './provider-contract-readiness.js';

const CHANNELS = new Set(['external_exchange', 'ai_direct_use']);
const OWNER_STATES = new Set(['pending', 'approved', 'rejected']);
const CRITICAL_CONTRACT_ITEMS = Object.freeze([
  'provider_identity_and_legal_entity',
  'server_only_authentication_and_account_scope',
  'stable_client_operation_idempotency_key',
  'idempotency_key_retention_vs_maximum_recovery_window',
  'same_key_same_payload_repeat_returns_same_transaction',
  'same_key_different_payload_must_be_rejected',
  'read_only_status_lookup_by_stable_operation_key',
  'finality_definition_and_post_final_reversal_window',
  'provider_transaction_id_stable_and_unique_in_scope',
  'webhook_authentication_replay_expiry_and_event_dedupe',
  'timeout_and_unknown_outcome_reconciliation',
  'partial_fulfillment_and_permanent_failure_handling',
  'cancel_before_dispatch_and_cancel_after_acceptance_semantics',
  'post_fulfillment_reversal_clawback_and_dispute_process'
]);
const DECISION_GROUPS = Object.freeze([
  Object.freeze({
    tier: 1,
    label: 'value_and_legal_safety',
    reason:
      'Point eligibility, funding, rounding and legal liability before vendor commitments',
    items: Object.freeze([
      'beta_earned_point_spending_eligibility',
      'funding_and_redemption_budgets_with_periods',
      'fractional_yen_point_settlement',
      'identity_legal_and_tax_approval'
    ])
  }),
  Object.freeze({
    tier: 2,
    label: 'channel_contract_and_price',
    reason: 'Provider/fees and AI prices require the tier-1 safety boundary',
    items: Object.freeze([
      'exchange_vendor_fee_and_product_selection',
      'ai_feature_point_prices'
    ])
  }),
  Object.freeze({
    tier: 3,
    label: 'formal_scout_progression',
    reason:
      'Level requirements are formal progression decisions, not direct Point settlement',
    items: Object.freeze([
      'level31_to_100_xp_thresholds',
      'level100_overflow_xp'
    ])
  }),
  Object.freeze({
    tier: 4,
    label: 'formal_release_and_cutover',
    reason:
      'Cutover date follows owner scope and the future independent live-proof gates',
    items: Object.freeze(['formal_launch_and_cutover_date'])
  })
]);
const DECISION_DEPENDENCIES = Object.freeze({
  beta_earned_point_spending_eligibility: Object.freeze([]),
  funding_and_redemption_budgets_with_periods: Object.freeze([]),
  fractional_yen_point_settlement: Object.freeze([]),
  identity_legal_and_tax_approval: Object.freeze([]),
  exchange_vendor_fee_and_product_selection: Object.freeze([
    'funding_and_redemption_budgets_with_periods',
    'identity_legal_and_tax_approval',
    'beta_earned_point_spending_eligibility'
  ]),
  ai_feature_point_prices: Object.freeze([
    'funding_and_redemption_budgets_with_periods',
    'beta_earned_point_spending_eligibility'
  ]),
  level31_to_100_xp_thresholds: Object.freeze([]),
  level100_overflow_xp: Object.freeze(['level31_to_100_xp_thresholds']),
  formal_launch_and_cutover_date: Object.freeze([
    'exchange_vendor_fee_and_product_selection',
    'ai_feature_point_prices',
    'level100_overflow_xp',
    'fractional_yen_point_settlement'
  ])
});
const record = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const frozen = (x) => Object.freeze(x);
const immutable = (items) => frozen(items.map((x) => frozen(x)));
const validLabel = (x) =>
  typeof x === 'string' && x.trim().length > 0 && x.trim().length <= 120;
const noEffects = Object.freeze({
  maySelectProvider: false,
  mayApproveOwnerDecisions: false,
  mayConnectDb: false,
  mayInvokeProvider: false,
  mayTransferValue: false,
  mayRunAI: false,
  maySettle: false,
  mayPublish: false
});
function channelScope(channel) {
  if (!CHANNELS.has(channel))
    throw new TypeError('Known Scout Point channel required');
}
/**
 * Compare only evidence completeness and gaps, NEVER generate a winner or a
 * provider suitability score. Provider/contract/version are supplied by the
 * caller and cannot prove signatures, business terms or production safety.
 */
export function compareScoutProviderCriteria({ channel, candidates = [] }) {
  channelScope(channel);
  if (!Array.isArray(candidates) || candidates.length > 12) {
    throw new TypeError('At most twelve mock candidate descriptions allowed');
  }
  const seen = new Set();
  const comparisons = candidates.map((candidate) => {
    if (
      !record(candidate) ||
      !validLabel(candidate.id) ||
      !validLabel(candidate.name) ||
      !validLabel(candidate.contractVersion) ||
      !Array.isArray(candidate.assertions) ||
      seen.has(candidate.id)
    ) {
      throw new TypeError(
        'Each candidate needs unique ID and bounded contract claims'
      );
    }
    seen.add(candidate.id);
    const survey = assessScoutProviderContract({
      channel,
      provider: {
        name: candidate.name,
        contractVersion: candidate.contractVersion
      },
      assertions: candidate.assertions
    });
    const byId = new Map(
      survey.requirements.map((item) => [item.id, item.evidenceStatus])
    );
    const criticalMissing = CRITICAL_CONTRACT_ITEMS.filter((item) => {
      const status = byId.get(item);
      return (
        status !== 'written_contract_reviewed' &&
        status !== 'isolated_test_observed'
      );
    });
    const reviewGaps = survey.requirements
      .filter(
        (item) =>
          item.evidenceStatus !== 'written_contract_reviewed' &&
          item.evidenceStatus !== 'isolated_test_observed'
      )
      .map((item) => item.id);
    return frozen({
      candidateId: candidate.id,
      displayName: candidate.name,
      claimedContractVersion: candidate.contractVersion,
      requirementCount: survey.requirementCount,
      reviewedOrTestedCount: survey.requirementCount - reviewGaps.length,
      declaredProviderClaimsCount: survey.requirements.filter(
        (item) => item.evidenceStatus === 'provider_claimed'
      ).length,
      requirementGaps: frozen(reviewGaps),
      criticalContractGaps: frozen(criticalMissing),
      invalidOrDuplicateAssertions: survey.inconsistentAssertionIds,
      providerLegalContractIndependentlyAuthenticated: false,
      serviceCapabilitiesVerified: false,
      eligibleForSelection: false,
      score: null,
      recommendation: null
    });
  });
  return frozen({
    status: 'candidate_evidence_comparison_only',
    channel,
    candidateCount: comparisons.length,
    providers: frozen(comparisons),
    providerChosen: null,
    comparisonCriteria: frozen([
      'nonnegotiable_finality_reversal_and_idempotency_proof',
      'server_auth_status_lookup_webhook_security',
      'unknown_timeout_duplicate_and_partial_recovery',
      'channel_specific_privacy_legal_tax_pricing_funding',
      'independently_tested_claim_wallet_budget_outbox_atomicity',
      'separate_owner_and_production_release_approvals'
    ]),
    unverifiedRealProviderContract: true,
    ...noEffects
  });
}

/**
 * An explicitly non-binding priority order for OWNER decision preparation.
 * This is a dependency-based recommendation, not an OWNER policy approval.
 */
export function prioritizeScoutOwnerDecisionQueue({ ownerDecisions = {} }) {
  if (!record(ownerDecisions)) {
    throw new TypeError('OWNER decision status map required');
  }
  const reference = mapScoutRewardDependencies({ ownerDecisions });
  const keys = reference.decisions.map((d) => d.id);
  for (const [key, state] of Object.entries(ownerDecisions)) {
    if (!keys.includes(key) || !OWNER_STATES.has(state)) {
      throw new TypeError(
        'Only the nine existing OWNER categories are supported'
      );
    }
  }
  const statuses = new Map(reference.decisions.map((x) => [x.id, x.status]));
  const decisions = [];
  for (const group of DECISION_GROUPS) {
    for (const id of group.items) {
      const dependsOn = DECISION_DEPENDENCIES[id];
      const unmet = dependsOn.filter((key) => statuses.get(key) !== 'approved');
      decisions.push(
        frozen({
          id,
          status: statuses.get(id),
          advisoryPriorityTier: group.tier,
          group: group.label,
          rationale: group.reason,
          dependencyIds: frozen([...dependsOn]),
          pendingDependencyIds: frozen(unmet),
          mayTreatAsOwnerApproved: false
        })
      );
    }
  }
  return frozen({
    status: 'owner_priority_advisory_only',
    priorities: immutable(
      DECISION_GROUPS.map((x) => ({
        tier: x.tier,
        group: x.label,
        reason: x.reason,
        decisionIds: frozen([...x.items])
      }))
    ),
    decisions: frozen(decisions),
    pendingDecisionIds: frozen(
      decisions.filter((x) => x.status !== 'approved').map((x) => x.id)
    ),
    directlyBlockingRedemptionDecisionIds: frozen([
      'beta_earned_point_spending_eligibility',
      'funding_and_redemption_budgets_with_periods',
      'fractional_yen_point_settlement',
      'identity_legal_and_tax_approval',
      'exchange_vendor_fee_and_product_selection'
    ]),
    directlyBlockingAiDecisionIds: frozen([
      'beta_earned_point_spending_eligibility',
      'funding_and_redemption_budgets_with_periods',
      'fractional_yen_point_settlement',
      'ai_feature_point_prices'
    ]),
    priorityOrderIsNotAnOwnerApproval: true,
    ...noEffects
  });
}

/**
 * A read-only preapproval checklist derived from Gate12 dependency model and
 * Gate13 provider criteria. It cannot activate a provider even if ALL
 * supplied flags claim green: no live contract/DB/approval can be proven by
 * application-provided metadata.
 */
export function compareScoutPreapprovalRequirements({
  channel,
  candidates = [],
  ownerDecisions = {},
  resources = {}
}) {
  channelScope(channel);
  const vendors = compareScoutProviderCriteria({ channel, candidates });
  const priorities = prioritizeScoutOwnerDecisionQueue({ ownerDecisions });
  const dependencies = mapScoutRewardDependencies({
    ownerDecisions,
    resources
  });
  const route = dependencies.routes.find((r) => r.channel === channel);
  const missingResources = route.unverifiedDurableResourceIds;
  const pendingOwners = route.pendingOwnerDecisionIds;
  const allCriticalContractGaps = vendors.providers.every(
    (v) =>
      v.criticalContractGaps.length > 0 ||
      v.invalidOrDuplicateAssertions.length > 0
  );
  const checklist = immutable([
    {
      item: 'owner_policy_and_liability',
      status: pendingOwners.length === 0 ? 'self_declared_complete' : 'blocked',
      outstandingIds: frozen([...pendingOwners])
    },
    {
      item: 'provider_selection_and_contract',
      status:
        vendors.candidateCount > 0 && !allCriticalContractGaps
          ? 'caller_claims_only'
          : 'blocked',
      outstandingIds: frozen(
        vendors.providers.flatMap((v) => v.criticalContractGaps)
      )
    },
    {
      item: 'durable_wallet_budget_claim_outbox',
      status:
        missingResources.length === 0 ? 'self_declared_complete' : 'blocked',
      outstandingIds: frozen([...missingResources])
    },
    {
      item: 'independent_security_legal_and_release_approval',
      status: 'not_performed',
      outstandingIds: frozen([...dependencies.crossCuttingFutureGates])
    }
  ]);
  return frozen({
    status: 'preapproval_requirements_only',
    channel,
    checklist,
    owners: priorities,
    vendors,
    resourceGaps: frozen([...missingResources]),
    lastGate: 'separate_independent_approvals_and_live_proof',
    independentEvidenceEstablished: false,
    viableProviderSelected: null,
    ...noEffects
  });
}
