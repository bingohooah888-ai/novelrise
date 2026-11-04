// Gate 03: immutable Scout state and XP-ledger review consistency PROPOSALS.
// No DB access, mutations, persistent locks, payouts or public wiring.
import { quoteScoutProgressAfterMaintenanceReview } from './rates.js';
import { quoteScoutMaintenanceWindow } from './maintenance-review.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function validUserId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new TypeError('State userId must be a server-verified UUID');
  }
  return value.toLowerCase();
}

function safeInt(value, name, lower = 0, upper = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < lower || value > upper) {
    throw new RangeError(name + ' must be a safe integer in the allowed range');
  }
  return value;
}

/**
 * Validate only current Level, next-Level progress, highest Level, review
 * checkpoint, account, and optimistic revision. There is NO lifetime-XP
 * aggregate. This snapshot is not a trusted state until retrieved by an
 * authorized server transaction.
 */
export function validateScoutLevelStateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new TypeError('Scout level snapshot is required');
  }
  const userId = validUserId(snapshot.userId);
  const currentLevel = safeInt(snapshot.currentLevel, 'currentLevel', 1, 100);
  const highestLevel = safeInt(snapshot.highestLevel, 'highestLevel', 1, 100);
  if (highestLevel < currentLevel) {
    throw new RangeError('Highest Level cannot be lower than current Level');
  }
  const levelProgressXp = safeInt(snapshot.levelProgressXp, 'levelProgressXp');
  const reviewAnchorMs = safeInt(snapshot.reviewAnchorMs, 'reviewAnchorMs');
  const revision = safeInt(
    snapshot.revision,
    'revision',
    0,
    Number.MAX_SAFE_INTEGER - 1
  );
  const lastReviewedWindowEndMs = snapshot.lastReviewedWindowEndMs;
  if (lastReviewedWindowEndMs !== null) {
    safeInt(lastReviewedWindowEndMs, 'lastReviewedWindowEndMs');
    const diff = lastReviewedWindowEndMs - reviewAnchorMs;
    if (diff < THIRTY_DAYS_MS || diff % THIRTY_DAYS_MS !== 0) {
      throw new RangeError(
        'Review checkpoint does not align to the saved 30-day anchor'
      );
    }
  }
  if (highestLevel >= 70 && currentLevel < 50) {
    throw new RangeError('Lv.70 milestone requires a minimum current Lv.50');
  }
  return Object.freeze({
    userId,
    currentLevel,
    highestLevel,
    levelProgressXp,
    reviewAnchorMs,
    lastReviewedWindowEndMs,
    revision
  });
}

function sameExpectedState(state, snapshot) {
  return Object.keys(state).every((key) => state[key] === snapshot[key]);
}

/**
 * Creates a non-executable CAS proposal from a Gate 02 dry-run quotation.
 * The given review quote is revalidated against the authoritative state
 * snapshot; neither snapshot nor quote alone proves DB authority.
 */
export function quoteScoutReviewStateTransition({
  stateSnapshot,
  reviewQuote
}) {
  const state = validateScoutLevelStateSnapshot(stateSnapshot);
  if (
    !reviewQuote ||
    typeof reviewQuote !== 'object' ||
    Array.isArray(reviewQuote)
  ) {
    throw new TypeError('A Gate 02 review quotation is required');
  }
  if (reviewQuote.status !== 'quotation_only') {
    return Object.freeze({ status: 'quote_not_eligible' });
  }

  const ordinal = safeInt(reviewQuote.reviewOrdinal, 'reviewOrdinal', 1);
  const window = quoteScoutMaintenanceWindow({
    firstWindowStartMs: state.reviewAnchorMs,
    reviewOrdinal: ordinal
  });
  const expectedKey =
    'scout-maintenance-v1:' + state.userId + ':' + window.windowEndMs;
  if (
    reviewQuote.reviewKey !== expectedKey ||
    reviewQuote.windowStartMs !== window.windowStartMs ||
    reviewQuote.windowEndMs !== window.windowEndMs
  ) {
    return Object.freeze({ status: 'review_identity_mismatch' });
  }

  const last = state.lastReviewedWindowEndMs;
  if (last !== null && last >= window.windowEndMs) {
    return Object.freeze({ status: 'already_reviewed' });
  }
  if (
    (ordinal === 1 && last !== null) ||
    (ordinal > 1 && last !== window.windowStartMs)
  ) {
    return Object.freeze({ status: 'checkpoint_mismatch' });
  }

  // A demotion resets XP to zero, so its RESULT alone cannot prove
  // which progress value was quoted. Bind the quotation to its SOURCE state.
  if (
    reviewQuote.quotedFromLevel !== state.currentLevel ||
    reviewQuote.quotedFromHighestLevel !== state.highestLevel ||
    reviewQuote.quotedFromLevelProgressXp !== state.levelProgressXp
  ) {
    return Object.freeze({ status: 'quote_state_mismatch' });
  }

  const earned = safeInt(
    reviewQuote.earnedXpInCompleted30DayWindow,
    'earnedXpInCompleted30DayWindow'
  );
  const expected = quoteScoutProgressAfterMaintenanceReview({
    currentLevel: state.currentLevel,
    verifiedHistoricalMaxLevel: state.highestLevel,
    earnedXpInCompleted30DayWindow: earned,
    currentLevelProgressXp: state.levelProgressXp
  });

  const fields = [
    'metQuota',
    'shouldDemote',
    'nextLevel',
    'nextLevelProgressXp'
  ];
  if (fields.some((key) => reviewQuote[key] !== expected[key])) {
    return Object.freeze({ status: 'quote_state_mismatch' });
  }

  const nextState = Object.freeze({
    ...state,
    currentLevel: expected.nextLevel,
    levelProgressXp: expected.nextLevelProgressXp,
    lastReviewedWindowEndMs: window.windowEndMs,
    revision: state.revision + 1
  });
  return Object.freeze({
    status: 'proposal_only',
    reviewKey: expectedKey,
    expectedState: state,
    nextState
  });
}

/**
 * A read-only, in-memory recheck of the intended atomic preconditions.
 * It does not claim any key or prove atomicity. A real server implementation
 * must check UNIQUE(user_id, window_end) plus a state-row revision predicate
 * INSIDE ONE DB transaction with ledger snapshot consistency.
 */
export function recheckScoutReviewProposal({
  proposal,
  currentStateSnapshot,
  reviewKeyAlreadyCommitted
}) {
  if (!proposal || proposal.status !== 'proposal_only') {
    throw new TypeError('A Gate 03 state proposal is required');
  }
  if (typeof reviewKeyAlreadyCommitted !== 'boolean') {
    throw new TypeError(
      'The committed review key must be verified on the server'
    );
  }
  const observed = validateScoutLevelStateSnapshot(currentStateSnapshot);
  if (
    reviewKeyAlreadyCommitted ||
    observed.lastReviewedWindowEndMs >=
      proposal.nextState.lastReviewedWindowEndMs
  ) {
    return Object.freeze({ status: 'already_reviewed' });
  }
  if (!sameExpectedState(proposal.expectedState, observed)) {
    return Object.freeze({ status: 'stale_state' });
  }
  return Object.freeze({
    status: 'preconditions_match_only',
    reviewKey: proposal.reviewKey,
    expectedRevision: proposal.expectedState.revision,
    proposedRevision: proposal.nextState.revision
  });
}
