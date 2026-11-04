import assert from 'node:assert/strict';
import test from 'node:test';
import {
  READER_REWARD_COMMENT_LIMIT,
  SCOUT_DEMOTION_FLOOR_AFTER_LEVEL_70,
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
