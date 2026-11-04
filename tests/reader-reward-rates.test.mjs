import assert from 'node:assert/strict';
import test from 'node:test';
import {
  READER_REWARD_COMMENT_LIMIT,
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

test('Lv.1-69 rewards remain undecided, never silently interpreted as zero', () => {
  for (const level of [1, 30, 69]) {
    assert.equal(quoteEpisodeRewardTenths(level), null);
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
