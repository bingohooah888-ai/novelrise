import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteScoutFirstDemotionReviewWindow } from '../api/_lib/reader-reward/rates.js';
import {
  quoteScoutMaintenanceWindow,
  quoteScoutMaintenanceReviewDryRun
} from '../api/_lib/reader-reward/maintenance-review.js';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherUser = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DAY = 86400000;
const RELEASE = Date.UTC(2027, 0, 1, 12);
const entry = (number, xp, timestamp, extra = {}) => ({
  id: '10000000-0000-4000-8000-' + String(number).padStart(12, '0'),
  user_id: userId,
  source_event_id:
    '20000000-0000-4000-8000-' + String(number).padStart(12, '0'),
  xp_kind: 'valid_read_episode',
  xp_value: xp,
  occurred_at: new Date(timestamp).toISOString(),
  ...extra
});
const input = (extra = {}) => ({
  accountId: userId,
  firstWindowStartMs: RELEASE,
  reviewOrdinal: 1,
  asOfMs: RELEASE + 30 * DAY,
  lastReviewedWindowEndMs: null,
  ledgerSnapshotComplete: true,
  verifiedLedgerRows: [],
  currentLevel: 90,
  verifiedHistoricalMaxLevel: 90,
  currentLevelProgressXp: 500,
  ...extra
});

test('one-based 30-day review windows are exact and contiguous', () => {
  const first = quoteScoutMaintenanceWindow({
    firstWindowStartMs: RELEASE,
    reviewOrdinal: 1
  });
  const second = quoteScoutMaintenanceWindow({
    firstWindowStartMs: RELEASE,
    reviewOrdinal: 2
  });
  assert.deepEqual(first, {
    reviewOrdinal: 1,
    windowStartMs: RELEASE,
    windowEndMs: RELEASE + 30 * DAY
  });
  assert.equal(second.windowStartMs, first.windowEndMs);
  assert.equal(second.windowEndMs, RELEASE + 60 * DAY);
  assert.equal(Object.isFrozen(first), true);
});

test('new signups use their own first-review anchor', () => {
  const signup = RELEASE + 17 * DAY;
  const cohort = quoteScoutFirstDemotionReviewWindow({
    formalReleaseAtMs: RELEASE,
    accountCreatedAtMs: signup
  });
  const period = quoteScoutMaintenanceWindow({
    firstWindowStartMs: cohort.windowStartMs,
    reviewOrdinal: 1
  });
  assert.equal(period.windowStartMs, signup);
  assert.equal(period.windowEndMs, signup + 30 * DAY);
});

test('period is start-inclusive and end-exclusive, counting existing ledger fields', () => {
  const review = quoteScoutMaintenanceReviewDryRun(
    input({
      verifiedLedgerRows: [
        entry(1, 150, RELEASE),
        entry(2, 49, RELEASE + 30 * DAY - 1),
        entry(3, 1000, RELEASE + 30 * DAY),
        entry(4, 1000, RELEASE - 1)
      ]
    })
  );
  assert.equal(review.status, 'quotation_only');
  assert.equal(review.earnedXpInCompleted30DayWindow, 199);
  assert.equal(review.ledgerRowsInWindow, 2);
  assert.equal(review.metQuota, false);
  assert.equal(review.nextLevel, 89);
  assert.equal(review.nextLevelProgressXp, 0);
  assert.equal(Object.hasOwn(review, 'lifetimeXp'), false);
});

test('exactly 200 XP keeps the level and its current progress', () => {
  const review = quoteScoutMaintenanceReviewDryRun(
    input({
      verifiedLedgerRows: [entry(1, 200, RELEASE)]
    })
  );
  assert.equal(review.earnedXpInCompleted30DayWindow, 200);
  assert.equal(review.metQuota, true);
  assert.equal(review.shouldDemote, false);
  assert.equal(review.nextLevel, 90);
  assert.equal(review.nextLevelProgressXp, 500);
});

test('future periods and incomplete evidence never quote demotion', () => {
  const future = quoteScoutMaintenanceReviewDryRun(
    input({ asOfMs: RELEASE + 30 * DAY - 1 })
  );
  const incomplete = quoteScoutMaintenanceReviewDryRun(
    input({ ledgerSnapshotComplete: false })
  );
  assert.equal(future.status, 'not_due');
  assert.equal(incomplete.status, 'evidence_incomplete');
  assert.equal(Object.hasOwn(future, 'shouldDemote'), false);
  assert.equal(Object.hasOwn(incomplete, 'shouldDemote'), false);
});

test('retries preserve stable review key and never apply duplicate demotion', () => {
  const first = quoteScoutMaintenanceReviewDryRun(input());
  const replay = quoteScoutMaintenanceReviewDryRun(
    input({
      lastReviewedWindowEndMs: first.windowEndMs
    })
  );
  assert.equal(replay.status, 'already_reviewed');
  assert.equal(replay.reviewKey, first.reviewKey);
  assert.equal(Object.hasOwn(replay, 'nextLevel'), false);
});

test('cannot silently skip an unsettled 30-day checkpoint', () => {
  const skipped = quoteScoutMaintenanceReviewDryRun(
    input({
      reviewOrdinal: 2,
      asOfMs: RELEASE + 60 * DAY
    })
  );
  assert.equal(skipped.status, 'checkpoint_mismatch');
  const second = quoteScoutMaintenanceReviewDryRun(
    input({
      reviewOrdinal: 2,
      asOfMs: RELEASE + 60 * DAY,
      lastReviewedWindowEndMs: RELEASE + 30 * DAY
    })
  );
  assert.equal(second.status, 'quotation_only');
  assert.notEqual(
    second.reviewKey,
    quoteScoutMaintenanceReviewDryRun(input()).reviewKey
  );
});

test('signed XP reversals block downgrade until attribution policy is approved', () => {
  const review = quoteScoutMaintenanceReviewDryRun(
    input({
      verifiedLedgerRows: [entry(1, 300, RELEASE), entry(2, -10, RELEASE + DAY)]
    })
  );
  assert.equal(review.status, 'xp_adjustment_review');
  assert.equal(Object.hasOwn(review, 'shouldDemote'), false);
});

test('mixed users and repeated XP source keys are fail-closed', () => {
  assert.throws(
    () =>
      quoteScoutMaintenanceReviewDryRun(
        input({
          verifiedLedgerRows: [entry(1, 100, RELEASE, { user_id: otherUser })]
        })
      ),
    RangeError
  );
  assert.throws(
    () =>
      quoteScoutMaintenanceReviewDryRun(
        input({
          verifiedLedgerRows: [
            entry(1, 100, RELEASE),
            entry(1, 100, RELEASE + DAY)
          ]
        })
      ),
    RangeError
  );
  assert.throws(
    () =>
      quoteScoutMaintenanceReviewDryRun(
        input({
          verifiedLedgerRows: [
            entry(1, 100, RELEASE),
            entry(2, 100, RELEASE + DAY, {
              source_event_id: entry(1, 100, RELEASE).source_event_id
            })
          ]
        })
      ),
    RangeError
  );
});

test('malformed server event rows and incomplete windows are rejected', () => {
  for (const broken of [
    entry(1, NaN, RELEASE),
    entry(1, 1000001, RELEASE),
    entry(1, 100, RELEASE, { occurred_at: '2027-01-01 12:00' }),
    entry(1, 100, RELEASE, { xp_kind: '' }),
    entry(1, 100, RELEASE, { source_event_id: '' })
  ]) {
    assert.throws(() =>
      quoteScoutMaintenanceReviewDryRun(
        input({
          verifiedLedgerRows: [broken]
        })
      )
    );
  }
  assert.throws(
    () =>
      quoteScoutMaintenanceReviewDryRun(
        input({
          verifiedLedgerRows: null
        })
      ),
    TypeError
  );
});

test('invalid ordinal and unsafe timestamps cannot generate a review window', () => {
  for (const ordinal of [0, -1, 1.5, NaN, '2', Number.MAX_SAFE_INTEGER]) {
    assert.throws(
      () =>
        quoteScoutMaintenanceWindow({
          firstWindowStartMs: RELEASE,
          reviewOrdinal: ordinal
        }),
      RangeError
    );
  }
  assert.throws(
    () =>
      quoteScoutMaintenanceWindow({
        firstWindowStartMs: Number.MAX_SAFE_INTEGER,
        reviewOrdinal: 1
      }),
    RangeError
  );
});

test('Lv.70 milestone protects Lv.50 floor even in a verified zero XP window', () => {
  const review = quoteScoutMaintenanceReviewDryRun(
    input({
      currentLevel: 50,
      verifiedHistoricalMaxLevel: 75,
      currentLevelProgressXp: 140
    })
  );
  assert.equal(review.status, 'quotation_only');
  assert.equal(review.metQuota, false);
  assert.equal(review.shouldDemote, false);
  assert.equal(review.nextLevel, 50);
  assert.equal(review.nextLevelProgressXp, 140);
});
