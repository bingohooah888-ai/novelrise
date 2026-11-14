// Gate 06: draft-only SCOUT Point grants, settlement and spending quotations.
// No DB access, real balance changes, payouts, AI invocation, or public wiring.
// OWNER 2026-11-05 revision: integer 10 Scout Points = 1 yen.
// New reward/redemption policies remain draft and cannot mutate beta balances.
export const SCOUT_POINTS_PER_YEN = 10;
export const SCOUT_POINT_YEN_VALUE = 1 / SCOUT_POINTS_PER_YEN;
export const SCOUT_POINT_MIN_EXTERNAL_EXCHANGE = 30000;
export const SCOUT_LEVEL_UP_POINTS = 50;
export const SCOUT_READER_BADGE_DEFINED_MAX_POINTS = 8350;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BADGE_ID = /^[a-z0-9][a-z0-9_-]{2,99}$/i;

function verifyUserId(id) {
  if (typeof id !== 'string' || !UUID.test(id)) {
    throw new TypeError('Point user id must be a verified UUID');
  }
  return id.toLowerCase();
}
function verifyNonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(label + ' must be a nonnegative safe integer');
  }
  return value;
}
function verifyPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(label + ' must be a positive safe integer');
  }
  return value;
}

/**
 * Existing point events use level_up:<user_id>:<level> and
 * badge:<user_id>:<badge_id>. Only verified FIRST-time awards are quoted.
 * Under OWNER demotion rules, earning the same Level again must not re-award.
 *
 * historicalEventKeys is an authoritative, complete ledger key snapshot
 * supplied by a future authorized server, NOT an optional client hint.
 */
export function quoteScoutMilestonePointGrant({
  userId,
  kind,
  reachedLevel = null,
  badgeId = null,
  readerBadgePointReward = null,
  historicalEventKeys,
  awardHistoryComplete,
  milestoneVerified,
  readerBadgeDefinitionVerified = false
}) {
  const id = verifyUserId(userId);
  let eventKey;
  let points;

  if (kind === 'level_up') {
    if (
      !Number.isSafeInteger(reachedLevel) ||
      reachedLevel < 2 ||
      reachedLevel > 100
    ) {
      throw new RangeError(
        'Level-up reward requires newly attained Level 2 through 100'
      );
    }
    eventKey = 'level_up:' + id + ':' + reachedLevel;
    points = SCOUT_LEVEL_UP_POINTS;
  } else if (kind === 'reader_badge') {
    if (typeof badgeId !== 'string' || !BADGE_ID.test(badgeId)) {
      throw new TypeError('Reader badge id is invalid');
    }
    eventKey = 'badge:' + id + ':' + badgeId;
    if (readerBadgeDefinitionVerified !== true) {
      return Object.freeze({ status: 'badge_definition_unverified', eventKey });
    }
    points = verifyNonnegativeInteger(
      readerBadgePointReward,
      'Reader badge points'
    );
  } else {
    throw new TypeError('Unrecognized Scout Point reward kind');
  }

  if (
    awardHistoryComplete !== true ||
    !Array.isArray(historicalEventKeys) ||
    milestoneVerified !== true
  ) {
    return Object.freeze({ status: 'award_evidence_incomplete', eventKey });
  }
  const known = new Set();
  for (const key of historicalEventKeys) {
    if (
      typeof key !== 'string' ||
      key.length < 1 ||
      key.length > 240 ||
      known.has(key)
    ) {
      throw new TypeError(
        'Incomplete or duplicated verified Scout Point event keys'
      );
    }
    known.add(key);
  }
  if (known.has(eventKey)) {
    return Object.freeze({ status: 'already_awarded', eventKey });
  }
  if (points === 0) {
    return Object.freeze({ status: 'no_point_reward', eventKey });
  }
  return Object.freeze({
    status: 'grant_quote_only',
    eventKey,
    userId: id,
    kind: kind === 'reader_badge' ? 'badge' : 'level_up',
    points,
    // A future transaction must use existing UNIQUE(event_key).
    requiresAtomicLedgerInsert: true,
    mayIssuePoints: false
  });
}

/**
 * In the OWNER-approved 10x unit, one integer Scout Point is exactly
 * 0.1 yen. Never round, multiply again, or issue without a live gate.
 */
export function quoteScoutTenthsYenAsPoints(tenthsYen) {
  verifyNonnegativeInteger(tenthsYen, 'Tenths of yen');
  return Object.freeze({
    status: 'exact_integer_quote_only',
    points: tenthsYen,
    amountTenthsYen: tenthsYen,
    mayIssuePoints: false
  });
}

/**
 * Pure, one-request wallet quote. The real available balance must come from
 * the authorized server's point ledger, after confirmed/pending/frozen/
 * cancelled, reversals, active holds, and user controls are reconciled.
 * availablePoints and verification flags DO NOT independently prove it.
 *
 * An external gift/exchange request has the OWNER floor of 30000 points.
 * Direct AI usage has NO 30000 point minimum and does NOT mint AI Credits.
 * This returns proposals only: never execution approval.
 */
export function quoteScoutPointUsage({
  userId,
  operationId,
  purpose,
  amountPoints,
  availablePoints,
  balanceRevision,
  authoritativeBalanceVerified,
  riskAndControlsCleared,
  duplicateOperationVerified,
  operationAlreadyCommitted,
  channelPolicyVerified,
  aiPriceApproved = false
}) {
  const id = verifyUserId(userId);
  const opId = operationId;
  if (typeof opId !== 'string' || !UUID.test(opId)) {
    throw new TypeError('Operation id must be a verified UUID');
  }
  if (purpose !== 'external_exchange' && purpose !== 'ai_direct_use') {
    throw new TypeError(
      'Only external exchange and direct AI usage are supported'
    );
  }
  const amount = verifyPositiveInteger(amountPoints, 'Point usage amount');
  verifyNonnegativeInteger(availablePoints, 'Available Scout Point balance');
  verifyNonnegativeInteger(balanceRevision, 'Balance revision');
  const operationKey = 'scout-point-use-v1:' + id + ':' + opId.toLowerCase();
  const context = { operationKey, purpose };
  if (
    duplicateOperationVerified !== true ||
    typeof operationAlreadyCommitted !== 'boolean'
  ) {
    return Object.freeze({
      status: 'operation_history_unverified',
      ...context
    });
  }
  if (operationAlreadyCommitted) {
    return Object.freeze({ status: 'already_processed', ...context });
  }
  if (
    purpose === 'external_exchange' &&
    amount < SCOUT_POINT_MIN_EXTERNAL_EXCHANGE
  ) {
    return Object.freeze({ status: 'below_exchange_minimum', ...context });
  }
  if (
    authoritativeBalanceVerified !== true ||
    riskAndControlsCleared !== true
  ) {
    return Object.freeze({ status: 'wallet_or_risk_unverified', ...context });
  }
  if (
    channelPolicyVerified !== true ||
    (purpose === 'ai_direct_use' && aiPriceApproved !== true)
  ) {
    return Object.freeze({ status: 'channel_policy_unapproved', ...context });
  }
  if (availablePoints < amount) {
    return Object.freeze({
      status: 'insufficient_available_points',
      ...context
    });
  }
  return Object.freeze({
    status: 'usage_quote_only',
    operationKey,
    userId: id,
    purpose,
    amountPoints: amount,
    // The canonical accounting value is ALWAYS integer tenths of yen.
    yenEquivalentTenths: amount,
    yenEquivalent: amount / SCOUT_POINTS_PER_YEN,
    expectedBalanceRevision: balanceRevision,
    expectedAvailablePoints: availablePoints,
    proposedRemainingPoints: availablePoints - amount,
    // Approval is never inferred from a quote, regardless of input flags.
    maySpendOrPayOut: false
  });
}

/**
 * In-memory precondition comparison, NOT an atomic wallet lock.
 * The future authorized transaction must claim operationKey uniquely,
 * lock/check the shared wallet and record reservations/settlements/refunds
 * consistently; concurrent external and AI use must share one balance.
 */
export function recheckScoutPointUsage({
  quote,
  observedBalanceRevision,
  observedAvailablePoints,
  operationAlreadyCommitted
}) {
  if (!quote || quote.status !== 'usage_quote_only') {
    throw new TypeError('A Gate06 Scout Point usage quote is required');
  }
  verifyNonnegativeInteger(
    observedBalanceRevision,
    'Observed balance revision'
  );
  verifyNonnegativeInteger(
    observedAvailablePoints,
    'Observed available points'
  );
  if (typeof operationAlreadyCommitted !== 'boolean') {
    throw new TypeError('A verified operation claim is required');
  }
  if (operationAlreadyCommitted) {
    return Object.freeze({ status: 'already_processed' });
  }
  if (
    observedBalanceRevision !== quote.expectedBalanceRevision ||
    observedAvailablePoints !== quote.expectedAvailablePoints
  ) {
    return Object.freeze({ status: 'stale_wallet' });
  }
  return Object.freeze({
    status: 'preconditions_match_only',
    operationKey: quote.operationKey,
    maySpendOrPayOut: false
  });
}
