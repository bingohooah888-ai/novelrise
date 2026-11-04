import assert from 'node:assert/strict';
import test from 'node:test';
import {
  READER_REWARD_COMMENT_LIMIT,
  SCOUT_DEMOTION_FLOOR_AFTER_LEVEL_70,
  SCOUT_DEMOTION_REVIEW_INTERVAL_DAYS,
  quoteScoutFirstDemotionReviewWindow,
  SCOUT_XP_MAINTENANCE_QUOTA_30_DAYS,
  quoteScoutMaintenanceLevelReview,
  isScoutDemotionReviewDue,
  applyVerifiedScoutDemotionFloor,
  READER_REWARD_UNIT,
  quoteEpisodeRewardTenths,
  quoteMonthlyCommentRewardTenths
} from '../api/_lib/reader-reward/rates.js';

test('draft reward amounts use exact integer tenths of a yen', () => {
  assert.equal(READER_REWARD_UNIT, 'tenth_yen');
  for (const [level, tenths] of [
    [70, 5],
    [74, 5],
    [75, 6],
    [79, 6],
    [80, 7],
    [84, 7],
    [85, 8],
    [89, 8],
    [90, 9],
    [94, 9],
    [95, 10],
    [99, 10],
    [100, 11]
  ]) {
    assert.equal(quoteEpisodeRewardTenths(level), tenths, `Lv.${level}`);
  }
});

test('approved Lv.1-69 quote bands include exact boundaries', () => {
  for (const [level, tenths] of [
    [1, 1],
    [19, 1],
    [20, 2],
    [39, 2],
    [40, 3],
    [59, 3],
    [60, 4],
    [69, 4]
  ]) {
    assert.equal(quoteEpisodeRewardTenths(level), tenths, `Lv.${level}`);
  }
});

test('every Scout level from 1 to 100 maps to its approved exact rate', () => {
  for (let level = 1; level <= 100; level++) {
    const expected =
      level < 20
        ? 1
        : level < 40
          ? 2
          : level < 60
            ? 3
            : level < 70
              ? 4
              : 5 + Math.floor((level - 70) / 5);
    assert.equal(quoteEpisodeRewardTenths(level), expected, `Lv.${level}`);
  }
});

test('invalid Scout levels are rejected', () => {
  for (const level of [0, 101, -1, 70.5, NaN, '70', Infinity]) {
    assert.throws(() => quoteEpisodeRewardTenths(level), RangeError);
  }
});

test('comment reward is ¥2 each, capped at 50 eligible comments and ¥100 per month', () => {
  assert.deepEqual(READER_REWARD_COMMENT_LIMIT, {
    yenPerEligibleComment: 2,
    eligibleCommentsPerMonth: 50,
    maxYenPerMonth: 100
  });
  assert.equal(quoteMonthlyCommentRewardTenths(0), 0);
  assert.equal(quoteMonthlyCommentRewardTenths(1), 20);
  assert.equal(quoteMonthlyCommentRewardTenths(49), 980);
  assert.equal(quoteMonthlyCommentRewardTenths(50), 1000);
  assert.equal(quoteMonthlyCommentRewardTenths(51), 1000);
  assert.equal(quoteMonthlyCommentRewardTenths(200), 1000);
});

test('invalid eligible comment counts are rejected', () => {
  for (const count of [-1, 0.2, NaN, '50', Infinity]) {
    assert.throws(() => quoteMonthlyCommentRewardTenths(count), RangeError);
  }
});

test('verified Lv.70 milestone activates Lv.50 demotion floor', () => {
  assert.equal(SCOUT_DEMOTION_FLOOR_AFTER_LEVEL_70, 50);
  for (const [proposed, historicalMax, expected] of [
    [70, 70, 70],
    [69, 70, 69],
    [50, 70, 50],
    [49, 70, 50],
    [1, 70, 50],
    [50, 100, 50],
    [1, 100, 50],
    [75, 100, 75]
  ]) {
    assert.equal(
      applyVerifiedScoutDemotionFloor(proposed, historicalMax),
      expected,
      `proposed Lv.${proposed} / verified max Lv.${historicalMax}`
    );
  }
});

test('reader never reaching Lv.70 does not gain an unapproved Lv.50 floor', () => {
  for (const [proposed, historicalMax] of [
    [1, 1],
    [19, 50],
    [49, 50],
    [30, 69],
    [69, 69]
  ]) {
    assert.equal(
      applyVerifiedScoutDemotionFloor(proposed, historicalMax),
      proposed
    );
  }
});

test('invalid or unverified downgrade inputs are rejected', () => {
  for (const [proposed, max] of [
    [49, 0],
    [49, 101],
    [49, NaN],
    [49.5, 70],
    [0, 70],
    [50, 49],
    ['50', 70]
  ]) {
    assert.throws(
      () => applyVerifiedScoutDemotionFloor(proposed, max),
      RangeError
    );
  }
});

test('Scout demotion review cadence is exactly 30 elapsed days', () => {
  assert.equal(SCOUT_DEMOTION_REVIEW_INTERVAL_DAYS, 30);
  const anchor = Date.UTC(2026, 11, 1, 0, 0, 0);
  const day = 24 * 60 * 60 * 1000;
  assert.equal(isScoutDemotionReviewDue(anchor, anchor), false);
  assert.equal(isScoutDemotionReviewDue(anchor, anchor + 29 * day), false);
  assert.equal(isScoutDemotionReviewDue(anchor, anchor + 30 * day - 1), false);
  assert.equal(isScoutDemotionReviewDue(anchor, anchor + 30 * day), true);
  assert.equal(isScoutDemotionReviewDue(anchor, anchor + 31 * day), true);
  assert.equal(isScoutDemotionReviewDue(anchor, anchor - 1), false);
  // Testing an illustrative UTC anchor does not authorize its use as launch time.
});

test('Scout review cadence rejects forged or invalid timestamps', () => {
  for (const [anchor, asOf] of [
    [-1, 1],
    [1.1, 2],
    [NaN, 1],
    [1, Infinity],
    ['1', 2],
    [0, Number.MAX_SAFE_INTEGER + 1]
  ]) {
    assert.throws(() => isScoutDemotionReviewDue(anchor, asOf), RangeError);
  }
});

test('exactly 200 XP maintains level, while 199 XP demotes one level', () => {
  assert.equal(SCOUT_XP_MAINTENANCE_QUOTA_30_DAYS, 200);
  for (const [windowXp, expectedLevel, expectedDemotion] of [
    [0, 89, true],
    [199, 89, true],
    [200, 90, false],
    [201, 90, false],
    [2000, 90, false]
  ]) {
    const result = quoteScoutMaintenanceLevelReview({
      currentLevel: 90,
      verifiedHistoricalMaxLevel: 90,
      earnedXpInCompleted30DayWindow: windowXp
    });
    assert.deepEqual(result, {
      metQuota: windowXp >= 200,
      shouldDemote: expectedDemotion,
      nextLevel: expectedLevel
    });
    assert.equal(Object.isFrozen(result), true);
  }
});

test('one review never demotes more than one level and respects history floor', () => {
  for (const [currentLevel, historicalMax, expectedLevel] of [
    [100, 100, 99],
    [70, 70, 69],
    [51, 80, 50],
    [50, 80, 50],
    [2, 30, 1],
    [1, 1, 1]
  ]) {
    const decision = quoteScoutMaintenanceLevelReview({
      currentLevel,
      verifiedHistoricalMaxLevel: historicalMax,
      earnedXpInCompleted30DayWindow: 0
    });
    assert.equal(decision.nextLevel, expectedLevel);
    assert.equal(decision.shouldDemote, expectedLevel < currentLevel);
  }
});

test('each 30-day window is evaluated independently without surplus carryover', () => {
  const first = quoteScoutMaintenanceLevelReview({
    currentLevel: 82,
    verifiedHistoricalMaxLevel: 82,
    earnedXpInCompleted30DayWindow: 600
  });
  assert.equal(first.nextLevel, 82);
  const second = quoteScoutMaintenanceLevelReview({
    currentLevel: first.nextLevel,
    verifiedHistoricalMaxLevel: 82,
    earnedXpInCompleted30DayWindow: 199
  });
  assert.equal(second.nextLevel, 81);
  assert.equal(second.shouldDemote, true);
});

test('quota preview rejects invalid or unverifiable XP or levels', () => {
  for (const input of [
    {
      currentLevel: 90,
      verifiedHistoricalMaxLevel: 80,
      earnedXpInCompleted30DayWindow: 100
    },
    {
      currentLevel: 0,
      verifiedHistoricalMaxLevel: 90,
      earnedXpInCompleted30DayWindow: 100
    },
    {
      currentLevel: 90,
      verifiedHistoricalMaxLevel: 101,
      earnedXpInCompleted30DayWindow: 100
    },
    {
      currentLevel: 90,
      verifiedHistoricalMaxLevel: 90,
      earnedXpInCompleted30DayWindow: -1
    },
    {
      currentLevel: 90,
      verifiedHistoricalMaxLevel: 90,
      earnedXpInCompleted30DayWindow: 12.5
    },
    {
      currentLevel: 90,
      verifiedHistoricalMaxLevel: 90,
      earnedXpInCompleted30DayWindow: '200'
    },
    { currentLevel: 90, verifiedHistoricalMaxLevel: 90 }
  ]) {
    assert.throws(() => quoteScoutMaintenanceLevelReview(input), RangeError);
  }
});

test('existing readers start the first 30-day review at formal release', () => {
  const release = Date.UTC(2027, 0, 1, 12);
  const dayMs = 24 * 60 * 60 * 1000;
  const review = quoteScoutFirstDemotionReviewWindow({
    formalReleaseAtMs: release,
    accountCreatedAtMs: release - 90 * dayMs
  });
  assert.deepEqual(review, {
    cohort: 'existing',
    windowStartMs: release,
    firstReviewDueAtMs: release + 30 * dayMs
  });
  assert.equal(Object.isFrozen(review), true);
  assert.equal(
    isScoutDemotionReviewDue(
      review.windowStartMs,
      review.firstReviewDueAtMs - 1
    ),
    false
  );
  assert.equal(
    isScoutDemotionReviewDue(review.windowStartMs, review.firstReviewDueAtMs),
    true
  );
});

test('post-release signups start their own 30-day first-review window', () => {
  const release = Date.UTC(2027, 0, 1, 12);
  const dayMs = 24 * 60 * 60 * 1000;
  for (const offset of [0, 1, 45 * dayMs]) {
    const registered = release + offset;
    const review = quoteScoutFirstDemotionReviewWindow({
      formalReleaseAtMs: release,
      accountCreatedAtMs: registered
    });
    assert.deepEqual(review, {
      cohort: 'new',
      windowStartMs: registered,
      firstReviewDueAtMs: registered + 30 * dayMs
    });
  }
  // Date.UTC above is illustrative only; the real formal-release date is unset.
});

test('first-review windows reject missing, forged, or unsafe instants', () => {
  for (const input of [
    { formalReleaseAtMs: undefined, accountCreatedAtMs: 0 },
    { formalReleaseAtMs: 0, accountCreatedAtMs: undefined },
    { formalReleaseAtMs: -1, accountCreatedAtMs: 0 },
    { formalReleaseAtMs: 0, accountCreatedAtMs: -1 },
    { formalReleaseAtMs: 0.5, accountCreatedAtMs: 0 },
    { formalReleaseAtMs: 0, accountCreatedAtMs: '1' },
    { formalReleaseAtMs: NaN, accountCreatedAtMs: 0 },
    { formalReleaseAtMs: Number.MAX_SAFE_INTEGER, accountCreatedAtMs: 0 }
  ]) {
    assert.throws(() => quoteScoutFirstDemotionReviewWindow(input), RangeError);
  }
});
