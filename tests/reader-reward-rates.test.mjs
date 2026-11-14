import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SCOUT_DEMOTION_FLOOR_AFTER_LEVEL_70,
  SCOUT_DEMOTION_REVIEW_INTERVAL_DAYS,
  quoteScoutFirstDemotionReviewWindow,
  SCOUT_XP_MAINTENANCE_QUOTA_30_DAYS,
  quoteScoutMaintenanceLevelReview,
  quoteScoutProgressAfterMaintenanceReview,
  isScoutDemotionReviewDue,
  applyVerifiedScoutDemotionFloor
} from '../api/_lib/reader-reward/rates.js';

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

test('demotion restarts progress at zero without any lifetime-XP total', () => {
  const result = quoteScoutProgressAfterMaintenanceReview({
    currentLevel: 90,
    verifiedHistoricalMaxLevel: 90,
    earnedXpInCompleted30DayWindow: 199,
    currentLevelProgressXp: 725
  });
  assert.deepEqual(result, {
    metQuota: false,
    shouldDemote: true,
    nextLevel: 89,
    nextLevelProgressXp: 0
  });
  assert.equal(Object.hasOwn(result, 'lifetimeXp'), false);
  assert.equal(Object.isFrozen(result), true);
});

test('meeting quota preserves in-level progress, and level floor does not reset it', () => {
  const kept = quoteScoutProgressAfterMaintenanceReview({
    currentLevel: 90,
    verifiedHistoricalMaxLevel: 90,
    earnedXpInCompleted30DayWindow: 200,
    currentLevelProgressXp: 725
  });
  assert.equal(kept.nextLevel, 90);
  assert.equal(kept.nextLevelProgressXp, 725);
  const floor = quoteScoutProgressAfterMaintenanceReview({
    currentLevel: 50,
    verifiedHistoricalMaxLevel: 80,
    earnedXpInCompleted30DayWindow: 0,
    currentLevelProgressXp: 350
  });
  assert.equal(floor.nextLevel, 50);
  assert.equal(floor.shouldDemote, false);
  assert.equal(floor.nextLevelProgressXp, 350);
});

test('progress projection rejects negative and unverified XP', () => {
  for (const xp of [-1, 12.2, '400', NaN, Infinity, undefined]) {
    assert.throws(
      () =>
        quoteScoutProgressAfterMaintenanceReview({
          currentLevel: 90,
          verifiedHistoricalMaxLevel: 90,
          earnedXpInCompleted30DayWindow: 199,
          currentLevelProgressXp: xp
        }),
      RangeError
    );
  }
});
