// Gate 04: independent, non-executable Scout XP level-up projections.
// No real XP grant, DB read/write, Cron, user-visible or payout path.
import { validateScoutLevelStateSnapshot } from './state-transition.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const XP_KIND = /^[a-z0-9_:-]{1,80}$/i;
const THIRTY_DAY_MS = 30 * 86400000;

function validUuid(value, label) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new TypeError(label + ' must be a verified UUID');
  }
  return value.toLowerCase();
}
function positiveXp(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1000000) {
    throw new RangeError('XP grant value must match the positive Scout XP ledger value range');
  }
  return value;
}
function validMs(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('XP grant time must be an integer UTC millisecond timestamp');
  }
  return value;
}
function confirmedThreshold(level, map) {
  if (!Object.prototype.hasOwnProperty.call(map, String(level))) return null;
  const required = map[String(level)];
  if (!Number.isSafeInteger(required) || required <= 0) {
    throw new RangeError('Confirmed XP threshold for Level ' + level + ' must be a positive safe integer');
  }
  return required;
}
function sameState(expected, current) {
  return Object.keys(expected).every(key => expected[key] === current[key]);
}

/**
 * Pure quote from an externally server-verified XP ledger entry plus a
 * SERVER-APPROVED required-XP table. No official Lv.31-100 XP numbers live
 * here. The approval/completeness flags DO NOT prove trust by themselves.
 *
 * An XP grant can raise multiple levels. Once reaching Lv.100 with surplus,
 * or when a needed next-level XP threshold is absent, return a HOLD status
 * without making a partial state proposal. No lifetime XP counter is used.
 *
 * The XP ledger remains the source for the 30-day 200 XP maintenance tally:
 * spending XP on a level does not change earned XP in that ledger.
 */
export function quoteScoutXpLevelUp({
  stateSnapshot,
  xpEvent,
  evidenceComplete,
  alreadyAppliedToProgress,
  thresholdsApproved,
  requiredXpByLevel
}) {
  const state = validateScoutLevelStateSnapshot(stateSnapshot);
  if (!xpEvent || typeof xpEvent !== 'object' || Array.isArray(xpEvent)) {
    throw new TypeError('An authoritative XP event candidate is required');
  }
  const userId = validUuid(xpEvent.userId, 'XP event user id');
  const sourceEventId = validUuid(xpEvent.sourceEventId, 'XP source event id');
  if (userId !== state.userId) {
    throw new RangeError('XP grant belongs to a different user');
  }
  const kind = xpEvent.xpKind;
  if (typeof kind !== 'string' || !XP_KIND.test(kind)) {
    throw new TypeError('XP kind must match the existing Scout XP ledger kind');
  }
  const earnedXp = positiveXp(xpEvent.earnedXp);
  const occurredAtMs = validMs(xpEvent.occurredAtMs);
  const grantKey = 'scout-xp-progress-v1:' + userId + ':' + sourceEventId + ':' + kind;
  const context = { grantKey };

  if (evidenceComplete !== true || typeof alreadyAppliedToProgress !== 'boolean') {
    return Object.freeze({ status: 'evidence_incomplete', ...context });
  }
  if (alreadyAppliedToProgress) {
    return Object.freeze({ status: 'already_applied', ...context });
  }
  if (occurredAtMs < state.reviewAnchorMs) {
    return Object.freeze({ status: 'outside_formal_release_window', ...context });
  }

  // Explicit ordering: if the next 30-day period is already over, review it
  // before quoting a newer grant. The grant itself is not silently discarded.
  const nextReviewEndMs =
    (state.lastReviewedWindowEndMs ?? state.reviewAnchorMs) + THIRTY_DAY_MS;
  if (!Number.isSafeInteger(nextReviewEndMs)) {
    throw new RangeError('Review window end timestamp overflow');
  }
  if (occurredAtMs >= nextReviewEndMs) {
    return Object.freeze({ status: 'review_checkpoint_due_first', ...context });
  }

  if (state.currentLevel === 100) {
    return Object.freeze({ status: 'level_cap_policy_pending', ...context });
  }
  if (thresholdsApproved !== true ||
      !requiredXpByLevel || typeof requiredXpByLevel !== 'object' ||
      Array.isArray(requiredXpByLevel)) {
    return Object.freeze({ status: 'thresholds_not_confirmed', ...context });
  }

  let level = state.currentLevel;
  let remaining = state.levelProgressXp + earnedXp;
  if (!Number.isSafeInteger(remaining)) {
    throw new RangeError('Level XP progress overflow');
  }
  const firstThreshold = confirmedThreshold(level, requiredXpByLevel);
  if (firstThreshold === null) {
    return Object.freeze({ status: 'threshold_missing', blockedAtLevel: level, ...context });
  }
  if (state.levelProgressXp >= firstThreshold) {
    return Object.freeze({ status: 'state_progress_inconsistent', ...context });
  }

  const levelsGained = [];
  while (level < 100) {
    // Exact promotion with no surplus does not require a threshold for the
    // newly attained next Level; that threshold may still be undecided.
    if (remaining === 0) break;
    const threshold = confirmedThreshold(level, requiredXpByLevel);
    if (threshold === null) {
      return Object.freeze({ status: 'threshold_missing', blockedAtLevel: level, ...context });
    }
    if (remaining < threshold) break;
    remaining -= threshold;
    level += 1;
    levelsGained.push(level);
  }
  if (level === 100 && remaining > 0) {
    return Object.freeze({ status: 'level_cap_policy_pending', ...context });
  }
  const nextState = Object.freeze({
    ...state,
    currentLevel: level,
    highestLevel: Math.max(state.highestLevel, level),
    levelProgressXp: remaining,
    revision: state.revision + 1
  });
  return Object.freeze({
    status: 'proposal_only',
    grantKey,
    quotedSourceEventId: sourceEventId,
    quotedXpKind: kind,
    quotedEarnedXp: earnedXp,
    expectedState: state,
    nextState,
    levelsGained: Object.freeze(levelsGained)
  });
}

/**
 * Non-atomic recheck for a future authoritative transaction. XP grant and
 * review both require a revision-CAS on the SAME state row; their proposals
 * MUST NOT be applied independently without a transactional unique claim.
 */
export function recheckScoutXpLevelUp({
  proposal,
  currentStateSnapshot,
  grantKeyAlreadyCommitted
}) {
  if (!proposal || proposal.status !== 'proposal_only') {
    throw new TypeError('A Gate 04 XP progression proposal is required');
  }
  if (typeof grantKeyAlreadyCommitted !== 'boolean') {
    throw new TypeError('An authoritative XP grant-key observation is required');
  }
  const observed = validateScoutLevelStateSnapshot(currentStateSnapshot);
  if (grantKeyAlreadyCommitted) {
    return Object.freeze({ status: 'already_applied' });
  }
  if (!sameState(proposal.expectedState, observed)) {
    return Object.freeze({ status: 'stale_state' });
  }
  return Object.freeze({
    status: 'preconditions_match_only',
    grantKey: proposal.grantKey,
    expectedRevision: proposal.expectedState.revision,
    proposedRevision: proposal.nextState.revision
  });
}
