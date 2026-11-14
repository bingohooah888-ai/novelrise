import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compileScoutFormalXpLadder,
  compileApprovedScoutFormalXpLadder,
  quoteApprovedScoutBetaFormalState
} from '../api/_lib/reader-reward/formal-thresholds.js';
import { quoteScoutXpLevelUp } from '../api/_lib/reader-reward/xp-progression.js';
import { quoteScoutMaintenanceReviewDryRun } from '../api/_lib/reader-reward/maintenance-review.js';
import { quoteScoutReviewStateTransition } from '../api/_lib/reader-reward/state-transition.js';

const betaRows = Array.from({ length: 30 }, (_, index) => ({
  level: index + 1,
  cumulative_xp: 10 * index * (index + 4),
  rule_version: 'beta-2026-09-21'
}));
// Synthetic values above Level 30, never the official Level 31..100 decision.
const proposalRows = Array.from({ length: 100 }, (_, index) => ({
  level: index + 1,
  cumulative_xp: 10 * index * (index + 4)
}));
function compile(rows = proposalRows) {
  return compileScoutFormalXpLadder({
    betaThresholdRows: betaRows,
    formalCumulativeRows: rows
  });
}

test('compiles a complete synthetic Lv.1-100 proposal into progress-gauge XP', () => {
  const result = compile();
  assert.equal(result.status, 'offline_preview_only');
  assert.equal(result.productionReady, false);
  assert.equal(result.ownerThresholdApprovalRequired, true);
  assert.equal(result.cumulativeByLevel[30], 9570);
  assert.equal(result.requiredXpByLevel[29], 610);
  assert.equal(result.requiredXpByLevel[30], 630);
  assert.equal(result.requiredXpByLevel[99], 2010);
  assert.equal(result.cumulativeByLevel[100], 101970);
  assert.equal(Object.hasOwn(result.requiredXpByLevel, '100'), false);
  assert.equal(Object.isFrozen(result.requiredXpByLevel), true);
});

test('rejects any change to existing beta Lv.1-30 XP', () => {
  assert.throws(
    () =>
      compile(
        proposalRows.map((row) =>
          row.level === 20
            ? { ...row, cumulative_xp: row.cumulative_xp + 1 }
            : row
        )
      ),
    /cannot rewrite beta/
  );
});

test('rejects missing, duplicated, unsorted and non-integer formal levels', () => {
  assert.throws(() => compile(proposalRows.slice(0, 99)), /Exactly 100/);
  assert.throws(
    () =>
      compile(
        proposalRows.map((row) =>
          row.level === 42 ? { ...row, level: 41 } : row
        )
      ),
    /1\.\.100/
  );
  assert.throws(
    () =>
      compile(
        proposalRows.map((row) =>
          row.level === 42 ? { ...row, cumulative_xp: -1 } : row
        )
      ),
    /increasing/
  );
  assert.throws(
    () =>
      compile(
        proposalRows.map((row) =>
          row.level === 42 ? { ...row, cumulative_xp: '20000' } : row
        )
      ),
    /increasing/
  );
});

test('supports a different future OWNER choice without hardcoded Lv.31-100 values', () => {
  const alternative = proposalRows.map((row) =>
    row.level > 30
      ? { ...row, cumulative_xp: row.cumulative_xp + 50 * (row.level - 30) }
      : row
  );
  const result = compile(alternative);
  assert.equal(result.requiredXpByLevel[30], 680);
  assert.equal(result.requiredXpByLevel[99], 2060);
  assert.equal(result.cumulativeByLevel[30], 9570);
  assert.equal(result.productionReady, false);
});

test('rejects cumulative XP overflow rather than silently rounding it', () => {
  assert.throws(
    () =>
      compile(
        proposalRows.map((row) =>
          row.level === 100
            ? { ...row, cumulative_xp: Number.MAX_SAFE_INTEGER + 1 }
            : row
        )
      ),
    /increasing/
  );
});

const userId = '00000000-0000-4000-8000-000000000001';
const release = Date.UTC(2027, 0, 1);
const DAY = 86400000;
function beta30(overrides = {}) {
  return {
    level: 30,
    total_xp: 9570,
    xp_into_level: 0,
    xp_for_next_level: 0,
    beta_level_max: true,
    raw_recorded_xp: 14000,
    ...overrides
  };
}
function formalBeta30(overrides = {}) {
  return quoteApprovedScoutBetaFormalState({
    userId,
    authenticatedBetaSummary: beta30(),
    betaThresholdRows: betaRows,
    formalReleaseAtMs: release,
    accountCreatedAtMs: release - 100 * DAY,
    ...overrides
  });
}

test('approved 400 XP progression preserves all beta thresholds and reaches 37,570 at Lv100', () => {
  const ladder = compileApprovedScoutFormalXpLadder({
    betaThresholdRows: betaRows
  });
  assert.equal(ladder.status, 'owner_thresholds_approved_offline');
  assert.equal(ladder.ownerThresholdApprovalRequired, false);
  assert.equal(ladder.productionReady, false);
  assert.equal(ladder.cumulativeByLevel[30], 9570);
  assert.equal(ladder.cumulativeByLevel[31], 9970);
  assert.equal(ladder.cumulativeByLevel[70], 25570);
  assert.equal(ladder.cumulativeByLevel[100], 37570);
  for (let level = 1; level <= 30; level += 1) {
    assert.equal(
      ladder.cumulativeByLevel[level],
      betaRows[level - 1].cumulative_xp
    );
  }
  for (let level = 30; level < 100; level += 1) {
    assert.equal(ladder.requiredXpByLevel[level], 400);
  }
  assert.equal(Object.hasOwn(ladder.requiredXpByLevel, '100'), false);
});

test('beta Lv30 initializes formal State at zero progress without carrying capped historical XP', () => {
  const handoff = formalBeta30();
  assert.equal(handoff.status, 'formal_state_quote_only');
  assert.equal(handoff.ready, false);
  assert.equal(handoff.state.currentLevel, 30);
  assert.equal(handoff.state.highestLevel, 30);
  assert.equal(handoff.state.levelProgressXp, 0);
  assert.equal(handoff.state.reviewAnchorMs, release);
  assert.equal(handoff.state.lastReviewedWindowEndMs, null);
  assert.equal(handoff.state.revision, 0);
  assert.equal(handoff.firstReviewDueAtMs, release + 30 * DAY);
  assert.equal(handoff.requiresServerLedgerCrossCheck, true);
  assert.equal(Object.hasOwn(handoff.state, 'raw_recorded_xp'), false);
});

test('post-release accounts do not reuse beta handoff and malformed beta state is held', () => {
  const later = formalBeta30({ accountCreatedAtMs: release + DAY });
  assert.equal(later.status, 'postrelease_registration_not_beta_handoff');
  assert.equal(later.ready, false);
  assert.equal(Object.hasOwn(later, 'state'), false);
  const mismatch = formalBeta30({
    authenticatedBetaSummary: beta30({ xp_into_level: 10 })
  });
  assert.equal(mismatch.status, 'beta_summary_mismatch');
  assert.equal(Object.hasOwn(mismatch, 'state'), false);
});

test('formal discovery XP and other newly confirmed XP advance the same 400 XP level gauge', () => {
  const handoff = formalBeta30();
  const makeGrant = (state, source, earnedXp, xpKind) =>
    quoteScoutXpLevelUp({
      stateSnapshot: state,
      xpEvent: {
        userId,
        sourceEventId: source,
        xpKind,
        earnedXp,
        occurredAtMs: release + DAY
      },
      evidenceComplete: true,
      alreadyAppliedToProgress: false,
      thresholdsApproved: true,
      requiredXpByLevel: handoff.requiredXpByLevel
    });
  const discovery = makeGrant(
    handoff.state,
    '00000000-0000-4000-8000-000000000002',
    300,
    'light_seed_discovery'
  );
  assert.equal(discovery.status, 'proposal_only');
  assert.equal(discovery.nextState.currentLevel, 30);
  assert.equal(discovery.nextState.levelProgressXp, 300);
  const read = makeGrant(
    discovery.nextState,
    '00000000-0000-4000-8000-000000000003',
    100,
    'valid_read'
  );
  assert.equal(read.status, 'proposal_only');
  assert.equal(read.nextState.currentLevel, 31);
  assert.equal(read.nextState.highestLevel, 31);
  assert.equal(read.nextState.levelProgressXp, 0);
});

test('30-day maintenance counts confirmed discovery XP and demotion resets progress', () => {
  const handoff = formalBeta30();
  const ledgerEvent = {
    id: '00000000-0000-4000-8000-000000000004',
    user_id: userId,
    source_event_id: '00000000-0000-4000-8000-000000000005',
    xp_kind: 'light_seed_discovery',
    xp_value: 200,
    occurred_at: new Date(release + DAY).toISOString()
  };
  const review = (rows, currentLevelProgressXp = 0) =>
    quoteScoutMaintenanceReviewDryRun({
      accountId: userId,
      firstWindowStartMs: release,
      reviewOrdinal: 1,
      asOfMs: release + 30 * DAY,
      ledgerSnapshotComplete: true,
      verifiedLedgerRows: rows,
      currentLevel: 30,
      verifiedHistoricalMaxLevel: 30,
      currentLevelProgressXp
    });
  const retained = review([ledgerEvent]);
  assert.equal(retained.status, 'quotation_only');
  assert.equal(retained.metQuota, true);
  assert.equal(retained.earnedXpInCompleted30DayWindow, 200);
  const decreased = review([], 100);
  assert.equal(decreased.status, 'quotation_only');
  assert.equal(decreased.shouldDemote, true);
  assert.equal(decreased.nextLevel, 29);
  assert.equal(decreased.nextLevelProgressXp, 0);
  const withProgress = { ...handoff.state, levelProgressXp: 100 };
  const transition = quoteScoutReviewStateTransition({
    stateSnapshot: withProgress,
    reviewQuote: decreased
  });
  assert.equal(transition.status, 'proposal_only');
  assert.equal(transition.nextState.currentLevel, 29);
  assert.equal(transition.nextState.levelProgressXp, 0);
});
