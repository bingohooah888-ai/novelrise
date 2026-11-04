// Gate 07: proposed Scout Point wallet state machine. All functions are pure.
// No external payment, AI use, DB transaction, balance writes, or claim insert.
import {
  SCOUT_POINT_MIN_EXTERNAL_EXCHANGE,
  SCOUT_POINT_YEN_VALUE
} from './scout-point-usage.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHASES = new Set([
  'new',
  'reserved',
  'committed',
  'released',
  'refunded'
]);
const ACTIONS = new Set(['reserve', 'commit', 'release', 'refund']);

function plain(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
function safeInt(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(label + ' must be a nonnegative safe integer');
  }
  return value;
}
function positive(value, label) {
  safeInt(value, label);
  if (value === 0) throw new RangeError(label + ' must be positive');
  return value;
}
function uuid(value, label) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new TypeError(label + ' must be an authoritative UUID');
  }
  return value.toLowerCase();
}
function safeSum(a, b) {
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw new RangeError('Point sum overflow');
  return result;
}
function subtract(a, b) {
  if (b > a) throw new RangeError('Inconsistent negative ledger state');
  return a - b;
}
function verifiedBalance(wallet) {
  if (!plain(wallet)) throw new TypeError('Wallet snapshot required');
  const userId = uuid(wallet.userId, 'Wallet user');
  const availablePoints = safeInt(wallet.availablePoints, 'Wallet available');
  const reservedPoints = safeInt(wallet.reservedPoints, 'Wallet reserved');
  const revision = safeInt(wallet.revision, 'Wallet revision');
  if (revision === Number.MAX_SAFE_INTEGER)
    throw new RangeError('Wallet revision overflow');
  return Object.freeze({ userId, availablePoints, reservedPoints, revision });
}
function verifiedBudget(budget) {
  if (!plain(budget)) throw new TypeError('Budget snapshot required');
  const scopeId = budget.scopeId;
  if (typeof scopeId !== 'string' || !/^[a-zA-Z0-9:_-]{1,120}$/.test(scopeId)) {
    throw new TypeError('Approved budget scope must be identified');
  }
  const limitPoints = safeInt(budget.limitPoints, 'Budget limit');
  const committedPoints = safeInt(budget.committedPoints, 'Budget committed');
  const reservedPoints = safeInt(budget.reservedPoints, 'Budget reserved');
  const revision = safeInt(budget.revision, 'Budget revision');
  if (revision === Number.MAX_SAFE_INTEGER)
    throw new RangeError('Budget revision overflow');
  if (safeSum(committedPoints, reservedPoints) > limitPoints) {
    throw new RangeError('Budget exceeds its approved maximum');
  }
  return Object.freeze({
    scopeId,
    limitPoints,
    committedPoints,
    reservedPoints,
    revision
  });
}
function verifiedOperation(operation) {
  if (!plain(operation)) throw new TypeError('Operation snapshot required');
  const userId = uuid(operation.userId, 'Operation user');
  const operationId = uuid(operation.operationId, 'Operation id');
  const purpose = operation.purpose;
  if (purpose !== 'external_exchange' && purpose !== 'ai_direct_use') {
    throw new TypeError('Invalid Point usage purpose');
  }
  const amountPoints = positive(operation.amountPoints, 'Operation amount');
  const phase = operation.phase;
  if (!PHASES.has(phase)) throw new TypeError('Invalid Point operation phase');
  const revision = safeInt(operation.revision, 'Operation revision');
  if (revision === Number.MAX_SAFE_INTEGER)
    throw new RangeError('Operation revision overflow');
  return Object.freeze({
    userId,
    operationId,
    purpose,
    amountPoints,
    phase,
    revision
  });
}
function comparable(a, b) {
  return Object.keys(a).every((key) => a[key] === b[key]);
}
function freezeProposal(
  action,
  key,
  wallet,
  budget,
  operation,
  nextWallet,
  nextBudget,
  nextOperation
) {
  return Object.freeze({
    status: 'proposal_only',
    action,
    operationKey: key,
    expectedWallet: wallet,
    expectedBudget: budget,
    expectedOperation: operation,
    nextWallet: Object.freeze(nextWallet),
    nextBudget: Object.freeze(nextBudget),
    nextOperation: Object.freeze(nextOperation),
    mayMovePointsOrMoney: false
  });
}

/**
 * Plans reserve -> commit OR release; committed -> refunded.
 * This is NOT a real transaction. The authorized backend must prove:
 * - full eligibility of confirmed points (beta-period treatment unresolved),
 * - pending, frozen, cancelled, reversal and other active reservations,
 * - fraud/identity/operation lookup and separate budget scope,
 * - a shared wallet lock, unique operation claim, and budget lock/CAS.
 * A true flag passed by a caller is NOT evidence of these conditions.
 */
export function quoteScoutPointOperation({
  action,
  walletSnapshot,
  budgetSnapshot,
  operationSnapshot,
  evidence
}) {
  if (!ACTIONS.has(action))
    throw new TypeError('Unsupported wallet transition');
  const wallet = verifiedBalance(walletSnapshot);
  const budget = verifiedBudget(budgetSnapshot);
  const operation = verifiedOperation(operationSnapshot);
  if (wallet.userId !== operation.userId) {
    return Object.freeze({ status: 'user_mismatch' });
  }
  const operationKey =
    'scout-point-use-v1:' + operation.userId + ':' + operation.operationId;
  if (
    !plain(evidence) ||
    evidence.authoritativeStateVerified !== true ||
    evidence.budgetPolicyApproved !== true ||
    evidence.pointEligibilityVerified !== true ||
    evidence.riskAndControlsCleared !== true ||
    evidence.operationUniquenessVerified !== true
  ) {
    return Object.freeze({
      status: 'evidence_or_budget_policy_incomplete',
      operationKey
    });
  }

  const amount = operation.amountPoints;
  const nextWallet = { ...wallet, revision: wallet.revision + 1 };
  const nextBudget = { ...budget, revision: budget.revision + 1 };
  const nextOperation = { ...operation, revision: operation.revision + 1 };

  if (action === 'reserve') {
    if (operation.phase !== 'new')
      return Object.freeze({ status: 'invalid_phase', operationKey });
    if (
      operation.purpose === 'external_exchange' &&
      amount < SCOUT_POINT_MIN_EXTERNAL_EXCHANGE
    ) {
      return Object.freeze({ status: 'below_exchange_minimum', operationKey });
    }
    if (
      evidence.channelPolicyApproved !== true ||
      (operation.purpose === 'ai_direct_use' &&
        evidence.aiPriceApproved !== true)
    ) {
      return Object.freeze({
        status: 'channel_policy_unapproved',
        operationKey
      });
    }
    if (wallet.availablePoints < amount) {
      return Object.freeze({
        status: 'insufficient_eligible_points',
        operationKey
      });
    }
    if (
      safeSum(safeSum(budget.committedPoints, budget.reservedPoints), amount) >
      budget.limitPoints
    ) {
      return Object.freeze({ status: 'budget_exceeded', operationKey });
    }
    nextWallet.availablePoints = subtract(wallet.availablePoints, amount);
    nextWallet.reservedPoints = safeSum(wallet.reservedPoints, amount);
    nextBudget.reservedPoints = safeSum(budget.reservedPoints, amount);
    nextOperation.phase = 'reserved';
  } else if (action === 'commit') {
    if (operation.phase !== 'reserved')
      return Object.freeze({ status: 'invalid_phase', operationKey });
    if (evidence.fulfillmentVerified !== true) {
      return Object.freeze({
        status: 'fulfillment_not_verified',
        operationKey
      });
    }
    if (wallet.reservedPoints < amount || budget.reservedPoints < amount) {
      return Object.freeze({
        status: 'reservation_snapshot_mismatch',
        operationKey
      });
    }
    nextWallet.reservedPoints = subtract(wallet.reservedPoints, amount);
    nextBudget.reservedPoints = subtract(budget.reservedPoints, amount);
    nextBudget.committedPoints = safeSum(budget.committedPoints, amount);
    nextOperation.phase = 'committed';
  } else if (action === 'release') {
    if (operation.phase !== 'reserved')
      return Object.freeze({ status: 'invalid_phase', operationKey });
    if (
      evidence.failureOrCancellationVerified !== true ||
      evidence.noFulfillmentVerified !== true
    ) {
      return Object.freeze({
        status: 'release_proof_incomplete',
        operationKey
      });
    }
    if (wallet.reservedPoints < amount || budget.reservedPoints < amount) {
      return Object.freeze({
        status: 'reservation_snapshot_mismatch',
        operationKey
      });
    }
    nextWallet.reservedPoints = subtract(wallet.reservedPoints, amount);
    nextWallet.availablePoints = safeSum(wallet.availablePoints, amount);
    nextBudget.reservedPoints = subtract(budget.reservedPoints, amount);
    nextOperation.phase = 'released';
  } else {
    if (operation.phase !== 'committed')
      return Object.freeze({ status: 'invalid_phase', operationKey });
    if (
      evidence.refundProofVerified !== true ||
      evidence.originalSettlementVerified !== true ||
      (operation.purpose === 'external_exchange' &&
        evidence.externalFundsRecoveryVerified !== true)
    ) {
      return Object.freeze({ status: 'refund_proof_incomplete', operationKey });
    }
    // Do not automatically recredit the period budget. That policy is not
    // OWNER-approved, even though the wallet's consumed points are restored.
    nextWallet.availablePoints = safeSum(wallet.availablePoints, amount);
    nextOperation.phase = 'refunded';
    nextBudget.revision = budget.revision;
  }
  return freezeProposal(
    action,
    operationKey,
    wallet,
    budget,
    operation,
    nextWallet,
    nextBudget,
    nextOperation
  );
}

/**
 * Read-only CAS precheck. Real guarantees require ONE DB transaction:
 * unique operation key + wallet and budget locks + operation phase revision.
 * A successful recheck only means that input snapshots still match.
 */
export function recheckScoutPointOperation({
  proposal,
  currentWalletSnapshot,
  currentBudgetSnapshot,
  currentOperationSnapshot,
  duplicateOperationClaimVerified,
  duplicateOperationClaimExists
}) {
  if (!plain(proposal) || proposal.status !== 'proposal_only') {
    throw new TypeError('A Gate07 proposal is required');
  }
  if (
    duplicateOperationClaimVerified !== true ||
    typeof duplicateOperationClaimExists !== 'boolean'
  ) {
    return Object.freeze({ status: 'unique_claim_unverified' });
  }
  if (duplicateOperationClaimExists && proposal.action === 'reserve') {
    return Object.freeze({ status: 'already_reserved' });
  }
  // Only the initial reservation can run without a durable operation claim.
  // Commit/release/refund MUST reference an existing, locked original claim;
  // otherwise a fabricated "reserved" snapshot could fabricate a release.
  if (!duplicateOperationClaimExists && proposal.action !== 'reserve') {
    return Object.freeze({ status: 'reservation_claim_missing' });
  }
  const wallet = verifiedBalance(currentWalletSnapshot);
  const budget = verifiedBudget(currentBudgetSnapshot);
  const operation = verifiedOperation(currentOperationSnapshot);
  if (
    !comparable(proposal.expectedWallet, wallet) ||
    !comparable(proposal.expectedBudget, budget) ||
    !comparable(proposal.expectedOperation, operation)
  ) {
    return Object.freeze({ status: 'stale_snapshot' });
  }
  return Object.freeze({
    status: 'preconditions_match_only',
    action: proposal.action,
    operationKey: proposal.operationKey,
    mayMovePointsOrMoney: false
  });
}

/**
 * Standalone, non-executable issuance budget guard. Issuance funding must
 * NEVER be mixed with the separate redemption/AI consumption budget.
 * The requested reward amount must already have a verified unique grant key.
 */
export function quoteScoutPointGrantBudget({
  pointsToIssue,
  fundingBudgetSnapshot,
  fundingBudgetVerified,
  awardEventUniqueVerified,
  awardEventPreviouslyIssued
}) {
  const points = positive(pointsToIssue, 'Reward points');
  const budget = verifiedBudget(fundingBudgetSnapshot);
  if (
    fundingBudgetVerified !== true ||
    awardEventUniqueVerified !== true ||
    typeof awardEventPreviouslyIssued !== 'boolean'
  ) {
    return Object.freeze({ status: 'funding_evidence_incomplete' });
  }
  if (awardEventPreviouslyIssued)
    return Object.freeze({ status: 'already_awarded' });
  if (
    safeSum(safeSum(budget.committedPoints, budget.reservedPoints), points) >
    budget.limitPoints
  ) {
    return Object.freeze({ status: 'funding_budget_exceeded' });
  }
  return Object.freeze({
    status: 'grant_budget_quote_only',
    points,
    expectedBudget: budget,
    proposedBudget: Object.freeze({
      ...budget,
      committedPoints: budget.committedPoints + points,
      revision: budget.revision + 1
    }),
    mayIssuePoints: false
  });
}
