// Draft-only reward quotation rules. This module has no side effects or payout paths.
// Amounts are integer tenths of a yen: 5 => ¥0.50, 11 => ¥1.10.
// Do not use this module to issue money or exchangeable balances before release approval.

export const READER_REWARD_UNIT = 'tenth_yen';

// Policy-only downgrade safeguard; never a source of progression evidence.
export const SCOUT_DEMOTION_FLOOR_AFTER_LEVEL_70 = 50;

/**
 * Apply the OWNER-approved floor to a proposed downgraded Scout level.
 * The caller must supply a server-verified historical maximum Scout level;
 * this helper does not decide when a downgrade is due or alter any DB state.
 * Reaching Lv.50 without ever reaching Lv.70 does not activate the floor.
 */
export function applyVerifiedScoutDemotionFloor(
  proposedLevel,
  verifiedHistoricalMaxLevel
) {
  for (const value of [proposedLevel, verifiedHistoricalMaxLevel]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
      throw new RangeError('Scout level must be an integer between 1 and 100');
    }
  }
  if (proposedLevel > verifiedHistoricalMaxLevel) {
    throw new RangeError(
      'A proposed demotion cannot exceed the verified maximum'
    );
  }
  if (verifiedHistoricalMaxLevel >= 70) {
    return Math.max(SCOUT_DEMOTION_FLOOR_AFTER_LEVEL_70, proposedLevel);
  }
  return proposedLevel;
}

export const READER_REWARD_COMMENT_LIMIT = Object.freeze({
  yenPerEligibleComment: 2,
  eligibleCommentsPerMonth: 50,
  maxYenPerMonth: 100
});

/**
 * Return a quoted reward for one valid episode read.
 * Rates are the approved formal-release draft for all levels 1 through 100.
 * This function must never be used as a grant or eligibility decision.
 */
export function quoteEpisodeRewardTenths(level) {
  if (!Number.isSafeInteger(level) || level < 1 || level > 100) {
    throw new RangeError('Scout level must be an integer between 1 and 100');
  }
  if (level < 20) return 1;
  if (level < 40) return 2;
  if (level < 60) return 3;
  if (level < 70) return 4;
  return 5 + Math.floor((level - 70) / 5);
}

/**
 * Quote the MONTHLY total for an already-validated count of reward-eligible
 * comments within a single policy month. The caller must independently verify
 * reading evidence, comment eligibility, month boundary, and duplicate claims.
 */
export function quoteMonthlyCommentRewardTenths(eligibleCommentCount) {
  if (!Number.isSafeInteger(eligibleCommentCount) || eligibleCommentCount < 0) {
    throw new RangeError(
      'Eligible comment count must be a nonnegative safe integer'
    );
  }
  return (
    Math.min(
      eligibleCommentCount,
      READER_REWARD_COMMENT_LIMIT.eligibleCommentsPerMonth
    ) * 20
  );
}
