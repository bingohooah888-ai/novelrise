// Draft-only reward quotation rules. This module has no side effects or payout paths.
// Amounts are integer tenths of a yen: 5 => ¥0.50, 11 => ¥1.10.
// Do not use this module to issue money or exchangeable balances before release approval.

export const READER_REWARD_UNIT = 'tenth_yen';

export const READER_REWARD_COMMENT_LIMIT = Object.freeze({
  yenPerEligibleComment: 2,
  eligibleCommentsPerMonth: 50,
  maxYenPerMonth: 100
});

/**
 * Return a quoted reward for one valid episode read.
 * null means the policy for Lv.1-69 is UNDECIDED, not zero.
 * This function must never be used as a grant or eligibility decision.
 */
export function quoteEpisodeRewardTenths(level) {
  if (!Number.isSafeInteger(level) || level < 1 || level > 100) {
    throw new RangeError('Scout level must be an integer between 1 and 100');
  }
  if (level < 70) return null;
  return 5 + Math.floor((level - 70) / 5);
}

/**
 * Quote the MONTHLY total for an already-validated count of reward-eligible
 * comments within a single policy month. The caller must independently verify
 * reading evidence, comment eligibility, month boundary, and duplicate claims.
 */
export function quoteMonthlyCommentRewardTenths(eligibleCommentCount) {
  if (!Number.isSafeInteger(eligibleCommentCount) || eligibleCommentCount < 0) {
    throw new RangeError('Eligible comment count must be a nonnegative safe integer');
  }
  return Math.min(eligibleCommentCount, READER_REWARD_COMMENT_LIMIT.eligibleCommentsPerMonth) * 20;
}
