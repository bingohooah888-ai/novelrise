// Internal, unregistered formal-only Scout Point usage service.
// This code never opens a DB connection or invokes an external provider.
// A trusted host must supply transactional persistence, approved policy
// validators, and a real fulfillment adapter after separate OWNER approval.
import { quoteScoutPointOperation } from './point-settlement.js';
import { SCOUT_POINT_MIN_EXTERNAL_EXCHANGE } from './scout-point-usage.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FEATURE_ID = /^[a-z][a-z0-9_-]{1,79}$/;
const positive = (n) => Number.isSafeInteger(n) && n > 0;
// public.scout_point_ledger.point_value CHECK (-1,000,000..1,000,000).
// Reject an unrecordable charge BEFORE reserving points or executing AI.
const CANONICAL_LEDGER_ENTRY_MAX = 1_000_000;
const safe = (n) => Number.isSafeInteger(n) && n >= 0;
const frozen = (value) => Object.freeze(value);
const response = (status, fields = {}) => frozen({ status, ...fields });

function validatedFeature(catalog, id) {
  if (typeof id !== 'string' || !FEATURE_ID.test(id)) return null;
  const feature = catalog.find((candidate) => candidate.id === id);
  return feature && feature.approved === true && positive(feature.pricePoints)
    ? feature
    : null;
}

export function createFormalRewardUsageService({
  repository,
  releaseConfiguration,
  trustedServerAuthorization,
  catalog = [],
  policy = {},
  aiExecutor,
  verifyGiftReceipt,
  verifyGiftNonFulfillment,
  verifyGiftRefund,
  verifyAiRefund
} = {}) {
  if (
    typeof repository?.transact !== 'function' ||
    typeof repository?.readReader !== 'function' ||
    typeof repository?.listPendingExchanges !== 'function' ||
    typeof repository?.findOperation !== 'function'
  ) {
    throw new TypeError(
      'Transactional, server-owned reward repository required'
    );
  }
  const approved = () =>
    releaseConfiguration?.formalRewardsEnabled === true &&
    releaseConfiguration?.productionCutoverApproved === true &&
    trustedServerAuthorization?.verifiedByTrustedServer === true &&
    trustedServerAuthorization?.serviceRoleVerified === true;

  function snapshotForQuote(wallet) {
    return {
      userId: wallet.userId,
      availablePoints: wallet.availablePoints,
      reservedPoints: wallet.reservedPoints,
      revision: wallet.revision
    };
  }

  function buildNewOperation({ userId, operationId, purpose, amountPoints }) {
    return {
      userId,
      operationId,
      purpose,
      amountPoints,
      phase: 'new',
      revision: 0
    };
  }

  async function applyTransition(
    tx,
    operation,
    action,
    verification,
    eligibleAllocation = 0
  ) {
    const wallet = await tx.getWallet(operation.userId);
    const budget = await tx.getBudget(operation.purpose);
    if (!wallet || !budget) return response('wallet_or_budget_unavailable');
    const proposal = quoteScoutPointOperation({
      action,
      walletSnapshot: snapshotForQuote(wallet),
      budgetSnapshot: budget,
      operationSnapshot: operation,
      evidence: {
        authoritativeStateVerified: true,
        budgetPolicyApproved: verification.budget === true,
        pointEligibilityVerified: verification.eligibility === true,
        riskAndControlsCleared: verification.risk === true,
        operationUniquenessVerified: true,
        channelPolicyApproved: verification.channel === true,
        aiPriceApproved: verification.aiPrice === true,
        fulfillmentVerified: verification.fulfillment === true,
        failureOrCancellationVerified: verification.failure === true,
        noFulfillmentVerified: verification.noFulfillment === true,
        refundProofVerified: verification.refundProof === true,
        originalSettlementVerified: verification.originalSettlement === true,
        externalFundsRecoveryVerified:
          verification.externalFundsRecovery === true
      }
    });
    if (proposal.status !== 'proposal_only') return response(proposal.status);
    // The memory adapter persists the combined wallet + shared budget +
    // operation state in one serialized operation. A production adapter must
    // provide equivalent database locking/rollback before it can be attached.
    const oldAllocated = operation.eligibleReservedPoints ?? 0;
    let nextEligible = wallet.exchangeEligiblePoints;
    if (action === 'reserve') nextEligible -= eligibleAllocation;
    if (action === 'release' || action === 'refund')
      nextEligible += oldAllocated;
    if (
      !safe(nextEligible) ||
      nextEligible > proposal.nextWallet.availablePoints ||
      (action === 'reserve' && eligibleAllocation > operation.amountPoints)
    ) {
      return response('eligible_point_allocation_invalid');
    }
    const nextOp = {
      ...proposal.nextOperation,
      ...(operation.featureId ? { featureId: operation.featureId } : {}),
      eligibleReservedPoints:
        action === 'reserve' ? eligibleAllocation : oldAllocated
    };
    await tx.save({
      wallet: { ...proposal.nextWallet, exchangeEligiblePoints: nextEligible },
      budget: proposal.nextBudget,
      operation: nextOp
    });
    return response('transition_recorded', { operation: nextOp });
  }

  async function reserve({
    userId,
    operationId,
    purpose,
    amountPoints,
    featureId
  }) {
    if (!approved()) return response('formal_use_disabled');
    if (
      !UUID.test(userId || '') ||
      !UUID.test(operationId || '') ||
      !positive(amountPoints)
    )
      return response('invalid_request');
    // Both the debit and a potential later refund must fit in one canonical
    // ledger row. A reservation above this ceiling can never be settled.
    if (amountPoints > CANONICAL_LEDGER_ENTRY_MAX)
      return response('canonical_ledger_entry_limit');
    if (
      purpose === 'external_exchange' &&
      amountPoints < SCOUT_POINT_MIN_EXTERNAL_EXCHANGE
    )
      return response('below_exchange_minimum');
    if (purpose === 'external_exchange' && policy.giftProviderReady !== true)
      return response('gift_provider_unavailable');
    return repository.transact(userId, async (tx) => {
      const wallet = await tx.getWallet(userId);
      if (!wallet || wallet.userId !== userId)
        return response('wallet_unavailable');
      const prior = await tx.getOperation(operationId);
      if (prior) {
        return response(
          prior.userId === userId &&
            prior.purpose === purpose &&
            prior.amountPoints === amountPoints &&
            (purpose !== 'ai_direct_use' || prior.featureId === featureId)
            ? 'already_processed'
            : 'operation_conflict',
          prior.userId === userId ? { phase: prior.phase } : {}
        );
      }
      if (
        !safe(wallet.exchangeEligiblePoints) ||
        wallet.exchangeEligiblePoints > wallet.availablePoints
      )
        return response('wallet_invalid');
      let approvedPolicy;
      try {
        approvedPolicy =
          purpose === 'external_exchange'
            ? await policy.verifyExchange?.({ userId, amountPoints })
            : await policy.verifyAi?.({ userId, featureId, amountPoints });
      } catch {
        approvedPolicy = null;
      }
      if (
        !approvedPolicy ||
        approvedPolicy.budget !== true ||
        approvedPolicy.eligibility !== true ||
        approvedPolicy.risk !== true ||
        approvedPolicy.channel !== true ||
        (purpose === 'ai_direct_use' && approvedPolicy.aiPrice !== true)
      )
        return response('policy_not_approved');
      let allocation;
      if (purpose === 'external_exchange') {
        if (wallet.exchangeEligiblePoints < amountPoints)
          return response('insufficient_exchange_eligible_points');
        allocation = amountPoints;
      } else if (purpose === 'ai_direct_use') {
        // Pool allocation is not an OWNER-decided policy. Host must supply an
        // approved strategy; never silently assume beta-first or formal-first.
        try {
          allocation = await policy.allocateAiEligiblePoints?.({
            userId,
            amountPoints,
            availablePoints: wallet.availablePoints,
            exchangeEligiblePoints: wallet.exchangeEligiblePoints
          });
        } catch {
          allocation = undefined;
        }
        const minimum = Math.max(
          0,
          amountPoints -
            (wallet.availablePoints - wallet.exchangeEligiblePoints)
        );
        if (
          !safe(allocation) ||
          allocation < minimum ||
          allocation > wallet.exchangeEligiblePoints ||
          allocation > amountPoints
        )
          return response('ai_pool_allocation_pending');
      } else {
        return response('unsupported_purpose');
      }
      const operation = {
        ...buildNewOperation({ userId, operationId, purpose, amountPoints }),
        ...(purpose === 'ai_direct_use' ? { featureId } : {})
      };
      const result = await applyTransition(
        tx,
        operation,
        'reserve',
        approvedPolicy,
        allocation
      );
      return result.status === 'transition_recorded'
        ? response('request_received', {
            operationId,
            phase: 'reserved',
            purpose,
            amountPoints
          })
        : result;
    });
  }

  async function transitionExisting({
    userId,
    operationId,
    purpose,
    action,
    verified
  }) {
    if (!approved()) return response('formal_use_disabled');
    if (!UUID.test(userId || '') || !UUID.test(operationId || ''))
      return response('invalid_request');
    return repository.transact(userId, async (tx) => {
      const wallet = await tx.getWallet(userId);
      if (!wallet || wallet.userId !== userId)
        return response('wallet_unavailable');
      const op = await tx.getOperation(operationId);
      if (!op || op.userId !== userId || op.purpose !== purpose)
        return response('operation_missing');
      if (op.phase !== (action === 'refund' ? 'committed' : 'reserved'))
        return response('already_processed', { phase: op.phase });
      const verification = {
        budget: true,
        eligibility: true,
        risk: true,
        channel: true,
        aiPrice: true,
        fulfillment: action === 'commit' && verified === 'success',
        failure: action === 'release' && verified === 'no_fulfillment',
        noFulfillment: action === 'release' && verified === 'no_fulfillment',
        refundProof: action === 'refund' && verified === 'recovered',
        originalSettlement: action === 'refund' && verified === 'recovered',
        externalFundsRecovery: action === 'refund' && verified === 'recovered'
      };
      if (
        (action === 'commit' && verified !== 'success') ||
        (action === 'release' && verified !== 'no_fulfillment') ||
        (action === 'refund' && verified !== 'recovered')
      )
        return response('fulfillment_evidence_missing');
      const r = await applyTransition(tx, op, action, verification);
      const finalPhase =
        action === 'commit'
          ? 'committed'
          : action === 'refund'
            ? 'refunded'
            : 'released';
      return r.status === 'transition_recorded'
        ? response(finalPhase, { operationId, phase: finalPhase })
        : r;
    });
  }

  async function requestExchange({ userId, operationId, amountPoints } = {}) {
    return reserve({
      userId,
      operationId,
      purpose: 'external_exchange',
      amountPoints
    });
  }

  async function requestAiUse({ userId, operationId, featureId } = {}) {
    if (!approved()) return response('formal_use_disabled');
    const feature = validatedFeature(catalog, featureId);
    if (!feature) return response('ai_price_or_feature_unapproved');
    if (typeof aiExecutor !== 'function')
      return response('ai_execution_unavailable');
    const reservation = await reserve({
      userId,
      operationId,
      purpose: 'ai_direct_use',
      amountPoints: feature.pricePoints,
      featureId
    });
    if (reservation.status !== 'request_received') return reservation;
    // Only the first new reservation can invoke the executor. Duplicate
    // operation IDs return already_processed without charging twice.
    let outcome;
    try {
      outcome = await aiExecutor({
        userId,
        operationId,
        featureId,
        maximumPoints: feature.pricePoints
      });
    } catch {
      return response('ai_execution_uncertain_held', { operationId });
    }
    if (
      outcome?.status === 'succeeded' &&
      outcome?.costPoints === feature.pricePoints
    ) {
      const settled = await transitionExisting({
        userId,
        operationId,
        purpose: 'ai_direct_use',
        action: 'commit',
        verified: 'success'
      });
      return settled.status === 'committed'
        ? response('started', { operationId, phase: 'committed' })
        : settled;
    }
    if (outcome?.status === 'not_executed') {
      return transitionExisting({
        userId,
        operationId,
        purpose: 'ai_direct_use',
        action: 'release',
        verified: 'no_fulfillment'
      });
    }
    return response('ai_execution_uncertain_held', { operationId });
  }

  async function getReaderSnapshot(userId) {
    if (!UUID.test(userId || '')) return response('invalid_request');
    const state = await repository.readReader(userId);
    if (!state) return response('wallet_unavailable');
    const enabled = approved();
    return {
      serverVerified: true,
      formalEnabled: enabled,
      exchangeEnabled: enabled && typeof policy.verifyExchange === 'function',
      giftProviderReady: enabled && policy.giftProviderReady === true,
      wallet: {
        availablePoints: state.wallet.availablePoints,
        exchangeEligiblePoints: state.wallet.exchangeEligiblePoints,
        heldPoints: state.wallet.heldPoints ?? 0
      },
      account: state.account || {},
      history: state.history || [],
      aiFeatures: catalog.map((f) => ({
        id: f.id,
        name: f.name,
        approved: f.approved === true,
        pricePoints: positive(f.pricePoints) ? f.pricePoints : null
      }))
    };
  }

  async function listPendingExchanges() {
    if (!approved()) return response('formal_use_disabled');
    const rows = await repository.listPendingExchanges();
    return response('queue_ready', {
      items: rows.map((op) => ({
        operationId: op.operationId,
        userId: op.userId,
        amountPoints: op.amountPoints,
        phase: op.phase
      }))
    });
  }

  async function resolveExchange({
    operationId,
    action,
    reviewerId,
    receipt
  } = {}) {
    if (!approved()) return response('formal_use_disabled');
    if (
      !UUID.test(operationId || '') ||
      !UUID.test(reviewerId || '') ||
      !['confirm_fulfilled', 'release_unfulfilled'].includes(action)
    )
      return response('invalid_request');
    const op = await repository.findOperation(operationId);
    if (!op || op.purpose !== 'external_exchange')
      return response('operation_missing');
    let verified = false;
    try {
      verified =
        action === 'confirm_fulfilled'
          ? await verifyGiftReceipt?.({ operation: op, reviewerId, receipt })
          : await verifyGiftNonFulfillment?.({
              operation: op,
              reviewerId,
              receipt
            });
    } catch {
      verified = false;
    }
    if (verified !== true) return response('fulfillment_evidence_missing');
    return transitionExisting({
      userId: op.userId,
      operationId,
      purpose: 'external_exchange',
      action: action === 'confirm_fulfilled' ? 'commit' : 'release',
      verified: action === 'confirm_fulfilled' ? 'success' : 'no_fulfillment'
    });
  }
  async function listRefundCandidates() {
    if (!approved()) return response('formal_use_disabled');
    if (typeof repository.listRefundCandidates !== 'function')
      return response('refund_queue_unavailable');
    const rows = await repository.listRefundCandidates();
    return response('refund_candidates_ready', {
      items: rows.map((op) => ({
        operationId: op.operationId,
        userId: op.userId,
        amountPoints: op.amountPoints,
        purpose: op.purpose,
        phase: op.phase
      }))
    });
  }

  // An independently confirmed provider refund or verified AI credit reversal
  // is required. No browser-provided receipt authorizes re-crediting a user.
  async function refundCommitted({ operationId, reviewerId } = {}) {
    if (!approved()) return response('formal_use_disabled');
    if (!UUID.test(operationId || '') || !UUID.test(reviewerId || ''))
      return response('invalid_request');
    const op = await repository.findOperation(operationId);
    if (!op || !['external_exchange', 'ai_direct_use'].includes(op.purpose))
      return response('operation_missing');
    if (op.phase !== 'committed')
      return response('already_processed', { phase: op.phase });
    let verified = false;
    try {
      verified =
        op.purpose === 'external_exchange'
          ? await verifyGiftRefund?.({ operation: op, reviewerId })
          : await verifyAiRefund?.({ operation: op, reviewerId });
    } catch {
      verified = false;
    }
    if (verified !== true) return response('refund_evidence_missing');
    return transitionExisting({
      userId: op.userId,
      operationId,
      purpose: op.purpose,
      action: 'refund',
      verified: 'recovered'
    });
  }

  return frozen({
    requestExchange,
    requestAiUse,
    getReaderSnapshot,
    listPendingExchanges,
    listRefundCandidates,
    resolveExchange,
    refundCommitted
  });
}
