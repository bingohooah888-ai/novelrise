// Draft-only formal Scout XP ladder: compile OWNER-supplied cumulative levels
// into the existing Gate 04 progress-gauge format. Never deploy or select values.
import {
  quoteScoutBetaToFormalHandoff,
  validateScoutBetaThresholds
} from './scout-db-compatibility.js';
import { validateScoutLevelStateSnapshot } from './state-transition.js';

function integer(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Offline feature adapter for an explicitly supplied 1..100 XP table.
 * No XP amounts are decided here. The beta 1..30 cumulative ladder is immutable.
 * A row for Lv.100 defines the final 99->100 step, not a required Lv.100->101 step.
 */
export function compileScoutFormalXpLadder({
  betaThresholdRows,
  formalCumulativeRows
}) {
  const beta = validateScoutBetaThresholds(betaThresholdRows);
  if (
    !Array.isArray(formalCumulativeRows) ||
    formalCumulativeRows.length !== 100
  ) {
    throw new RangeError('Exactly 100 formal level rows are required');
  }
  const byLevel = {};
  let preceding = -1;
  for (let index = 0; index < 100; index += 1) {
    const row = formalCumulativeRows[index];
    const level = index + 1;
    if (
      row === null ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      row.level !== level ||
      !integer(row.cumulative_xp) ||
      row.cumulative_xp <= preceding
    ) {
      throw new RangeError(
        'Formal XP rows must be 1..100 with increasing cumulative XP'
      );
    }
    if (level <= 30 && row.cumulative_xp !== beta.cumulativeByLevel[level]) {
      throw new RangeError(
        'Formal ladder cannot rewrite beta Lv.1-30 thresholds'
      );
    }
    byLevel[level] = row.cumulative_xp;
    preceding = row.cumulative_xp;
  }
  const requiredXpByLevel = {};
  for (let level = 1; level < 100; level += 1) {
    requiredXpByLevel[level] = byLevel[level + 1] - byLevel[level];
  }
  return Object.freeze({
    status: 'offline_preview_only',
    betaRuleVersion: beta.ruleVersion,
    levelCap: 100,
    cumulativeByLevel: Object.freeze(byLevel),
    requiredXpByLevel: Object.freeze(requiredXpByLevel),
    // These values are not official until separately approved by the OWNER.
    ownerThresholdApprovalRequired: true,
    productionReady: false
  });
}

/**
 * OWNER-approved 2026-11-10 formal-release progression.
 * Preserve the 30 historical beta levels (Lv.30 cumulative 9,570 XP).
 * Exactly 400 XP is required for each promotion from Lv.30 to Lv.100.
 * This is a dormant source of future thresholds, not a beta or DB cutover.
 */
export const FORMAL_SCOUT_XP_PER_LEVEL_AFTER_30 = 400;
export const FORMAL_SCOUT_MAX_LEVEL = 100;
export const FORMAL_SCOUT_LEVEL_100_CUMULATIVE_XP = 37570;

export function compileApprovedScoutFormalXpLadder({ betaThresholdRows }) {
  const beta = validateScoutBetaThresholds(betaThresholdRows);
  const formalCumulativeRows = Array.from(
    { length: FORMAL_SCOUT_MAX_LEVEL },
    (_, index) => {
      const level = index + 1;
      return {
        level,
        cumulative_xp:
          level <= 30
            ? beta.cumulativeByLevel[level]
            : beta.cumulativeByLevel[30] +
              (level - 30) * FORMAL_SCOUT_XP_PER_LEVEL_AFTER_30
      };
    }
  );
  const ladder = compileScoutFormalXpLadder({
    betaThresholdRows,
    formalCumulativeRows
  });
  if (
    ladder.cumulativeByLevel[100] !== FORMAL_SCOUT_LEVEL_100_CUMULATIVE_XP ||
    ladder.requiredXpByLevel[30] !== FORMAL_SCOUT_XP_PER_LEVEL_AFTER_30 ||
    ladder.requiredXpByLevel[99] !== FORMAL_SCOUT_XP_PER_LEVEL_AFTER_30
  ) {
    throw new RangeError(
      'Approved Level 100 ladder does not match OWNER policy'
    );
  }
  return Object.freeze({
    ...ladder,
    status: 'owner_thresholds_approved_offline',
    ownerThresholdApprovalRequired: false,
    // Explicitly separate the XP policy decision from production deployment.
    productionReady: false
  });
}

/**
 * Formal launch-only state initializer preview. Reuses Gate 05 beta handoff
 * rather than reinterpreting beta XP or replaying capped discovery rewards.
 * There is no DB I/O, no release timestamp default and no user-state write.
 */
export function quoteApprovedScoutBetaFormalState({
  userId,
  authenticatedBetaSummary,
  betaThresholdRows,
  formalReleaseAtMs,
  accountCreatedAtMs
}) {
  const handoff = quoteScoutBetaToFormalHandoff({
    authenticatedBetaSummary,
    betaThresholdRows,
    formalReleaseAtMs,
    accountCreatedAtMs
  });
  if (handoff.status !== 'handoff_quote_only') {
    return Object.freeze({
      status: handoff.status,
      ready: false
    });
  }
  const ladder = compileApprovedScoutFormalXpLadder({ betaThresholdRows });
  const state = validateScoutLevelStateSnapshot({
    userId,
    ...handoff.proposed,
    lastReviewedWindowEndMs: null,
    revision: 0
  });
  if (state.levelProgressXp >= ladder.requiredXpByLevel[state.currentLevel]) {
    return Object.freeze({
      status: 'beta_progress_mismatch',
      ready: false
    });
  }
  return Object.freeze({
    status: 'formal_state_quote_only',
    ready: false,
    state,
    firstReviewDueAtMs: handoff.firstReviewDueAtMs,
    requiredXpByLevel: ladder.requiredXpByLevel,
    requiresServerLedgerCrossCheck: true,
    requiresOwnerReleaseApproval: true
  });
}
