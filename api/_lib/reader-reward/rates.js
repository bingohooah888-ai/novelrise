// Draft-only reward quotation rules. This module has no side effects or payout paths.
// Amounts are integer tenths of a yen: 5 => ¥0.50, 11 => ¥1.10.
// Do not use this module to issue money or exchangeable balances before release approval.

export const READER_REWARD_UNIT = 'tenth_yen';

// Policy-only downgrade safeguard; never a source of progression evidence.
export const SCOUT_DEMOTION_FLOOR_AFTER_LEVEL_70 = 50;

// OWNER-approved cadence: exactly 30 elapsed days between review checkpoints.
// First review starts at formal release for existing readers, or signup for new readers.
// No release date is assumed; automated scheduling remains disabled.
export const SCOUT_DEMOTION_REVIEW_INTERVAL_DAYS = 30;

export const SCOUT_XP_MAINTENANCE_QUOTA_30_DAYS = 200;

/**
 * Preview the OWNER-approved review outcome for one completed, authoritative
 * 30-day XP accrual window. This pure function must not be called with browser-
 * supplied values, schedule reviews, deduct ledger XP or mutate user levels.
 *
 * No surplus XP is carried forward: the caller independently provides the
 * credited XP earned in the specific completed window under review.
 */
export function quoteScoutMaintenanceLevelReview({
  currentLevel,
  verifiedHistoricalMaxLevel,
  earnedXpInCompleted30DayWindow
}) {
  for (const level of [currentLevel, verifiedHistoricalMaxLevel]) {
    if (!Number.isSafeInteger(level) || level < 1 || level > 100) {
      throw new RangeError('Scout level must be an integer between 1 and 100');
    }
  }
  if (currentLevel > verifiedHistoricalMaxLevel) {
    throw new RangeError(
      'Current Scout level exceeds verified historical maximum'
    );
  }
  if (
    !Number.isSafeInteger(earnedXpInCompleted30DayWindow) ||
    earnedXpInCompleted30DayWindow < 0
  ) {
    throw new RangeError(
      'Authoritatively credited 30-day XP must be a nonnegative safe integer'
    );
  }

  const metQuota =
    earnedXpInCompleted30DayWindow >= SCOUT_XP_MAINTENANCE_QUOTA_30_DAYS;
  const proposedLevel = metQuota ? currentLevel : Math.max(1, currentLevel - 1);
  const nextLevel = applyVerifiedScoutDemotionFloor(
    proposedLevel,
    verifiedHistoricalMaxLevel
  );
  return Object.freeze({
    metQuota,
    shouldDemote: nextLevel < currentLevel,
    nextLevel
  });
}
/**
 * Quote the level progress after a maintenance review.
 * On a genuine demotion, the downgraded level starts with 0 XP toward its
 * next level; returning to the former level requires earning new XP via
 * ordinary progression. There is no separate lifetime-XP counter;
 * existing server XP event records remain available for audit and review.
 * When the level is maintained (including a protected floor), keep the
 * existing level-progress XP unchanged.
 * This remains dormant and does not write state or grant levels.
 */
export function quoteScoutProgressAfterMaintenanceReview({
  currentLevel,
  verifiedHistoricalMaxLevel,
  earnedXpInCompleted30DayWindow,
  currentLevelProgressXp
}) {
  if (!Number.isSafeInteger(currentLevelProgressXp) || currentLevelProgressXp < 0) {
    throw new RangeError(
      'Current-level progression XP must be a nonnegative safe integer'
    );
  }
  const review = quoteScoutMaintenanceLevelReview({
    currentLevel,
    verifiedHistoricalMaxLevel,
    earnedXpInCompleted30DayWindow
  });
  return Object.freeze({
    ...review,
    nextLevelProgressXp: review.shouldDemote ? 0 : currentLevelProgressXp
  });
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const SCOUT_REVIEW_INTERVAL_MS =
  SCOUT_DEMOTION_REVIEW_INTERVAL_DAYS * MILLISECONDS_PER_DAY;

/**
 * Pure first-review window: accounts existing before formal release start
 * counting from release, while post-release registrations count from signup.
 * The authoritative release and signup instants must come from the server.
 * This does NOT activate scheduling, grant XP, or change any Scout level.
 */
export function quoteScoutFirstDemotionReviewWindow({
  formalReleaseAtMs,
  accountCreatedAtMs
}) {
  for (const value of [formalReleaseAtMs, accountCreatedAtMs]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(
        'Formal release and account creation must be verified UTC millisecond timestamps'
      );
    }
  }
  const windowStartMs = Math.max(formalReleaseAtMs, accountCreatedAtMs);
  const firstReviewDueAtMs = windowStartMs + SCOUT_REVIEW_INTERVAL_MS;
  if (!Number.isSafeInteger(firstReviewDueAtMs)) {
    throw new RangeError('First review timestamp exceeds safe integer range');
  }
  return Object.freeze({
    cohort: accountCreatedAtMs < formalReleaseAtMs ? 'existing' : 'new',
    windowStartMs,
    firstReviewDueAtMs
  });
}

/**
 * Check whether a 30-day review window has elapsed since an externally
 * verified review anchor (or the preceding authorized review checkpoint).
 * Does not choose the launch date, schedule jobs, or apply demotions.
 */
export function isScoutDemotionReviewDue(lastReviewCheckpointMs, asOfMs) {
  for (const timestamp of [lastReviewCheckpointMs, asOfMs]) {
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new RangeError(
        'Review timestamps must be nonnegative integer UTC milliseconds'
      );
    }
  }
  return (
    asOfMs - lastReviewCheckpointMs >=
    SCOUT_DEMOTION_REVIEW_INTERVAL_DAYS * MILLISECONDS_PER_DAY
  );
}

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
