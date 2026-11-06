import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteScoutMaintenanceReviewDryRun } from '../api/_lib/reader-reward/maintenance-review.js';
import {
  quoteScoutReviewStateTransition,
  recheckScoutReviewProposal
} from '../api/_lib/reader-reward/state-transition.js';
import {
  quoteScoutXpLevelUp,
  recheckScoutXpLevelUp
} from '../api/_lib/reader-reward/xp-progression.js';

const day = 86400000;
const start = Date.UTC(2027, 2, 1, 12);
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sourceEventId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
// Test-only synthetic thresholds; not OWNER-approved production values.
const fakeThresholds = Object.freeze({
  1: 30,
  2: 50,
  68: 100,
  69: 100,
  70: 300,
  71: 400,
  89: 1700,
  90: 1900,
  99: 50
});
const state = (edits = {}) => ({
  userId,
  currentLevel: 68,
  highestLevel: 68,
  levelProgressXp: 20,
  reviewAnchorMs: start,
  lastReviewedWindowEndMs: null,
  revision: 3,
  ...edits
});
const grant = (edits = {}) => ({
  userId,
  sourceEventId,
  xpKind: 'discovery_success',
  earnedXp: 200,
  occurredAtMs: start + day,
  ...edits
});
const xp = (edits = {}) => ({
  stateSnapshot: state(),
  xpEvent: grant(),
  evidenceComplete: true,
  alreadyAppliedToProgress: false,
  thresholdsApproved: true,
  requiredXpByLevel: fakeThresholds,
  ...edits
});
const review = (snapshot, ledgerRows, reviewOrdinal = 1) => {
  const windowStartMs = start + (reviewOrdinal - 1) * 30 * day;
  return quoteScoutMaintenanceReviewDryRun({
    accountId: userId,
    firstWindowStartMs: start,
    reviewOrdinal,
    asOfMs: windowStartMs + 30 * day,
    lastReviewedWindowEndMs: snapshot.lastReviewedWindowEndMs,
    ledgerSnapshotComplete: true,
    verifiedLedgerRows: ledgerRows,
    currentLevel: snapshot.currentLevel,
    verifiedHistoricalMaxLevel: snapshot.highestLevel,
    currentLevelProgressXp: snapshot.levelProgressXp
  });
};
const ledgerRow = (value, atMs = start + day) => ({
  id: '10000000-0000-4000-8000-000000000001',
  user_id: userId,
  source_event_id: sourceEventId,
  xp_kind: 'discovery_success',
  xp_value: value,
  occurred_at: new Date(atMs).toISOString()
});

test('a level-up uses only supplied confirmed XP thresholds and preserves remainder', () => {
  const result = quoteScoutXpLevelUp(xp());
  assert.equal(result.status, 'proposal_only');
  assert.deepEqual(result.levelsGained, [69, 70]);
  assert.deepEqual(result.nextState, {
    ...state(),
    currentLevel: 70,
    highestLevel: 70,
    levelProgressXp: 20,
    revision: 4
  });
  assert.equal(result.quotedEarnedXp, 200);
  assert.equal(Object.hasOwn(result.nextState, 'lifetimeXp'), false);
  assert.equal(Object.isFrozen(result.nextState), true);
  assert.equal(Object.isFrozen(result.levelsGained), true);
});

test('one threshold gives partial XP progress without a level change', () => {
  const result = quoteScoutXpLevelUp(
    xp({
      xpEvent: grant({ earnedXp: 40 })
    })
  );
  assert.equal(result.status, 'proposal_only');
  assert.deepEqual(result.levelsGained, []);
  assert.equal(result.nextState.currentLevel, 68);
  assert.equal(result.nextState.levelProgressXp, 60);
  assert.equal(result.nextState.revision, 4);
});

test('the same XP source is not applied twice', () => {
  const first = quoteScoutXpLevelUp(xp());
  const repeated = quoteScoutXpLevelUp(xp({ alreadyAppliedToProgress: true }));
  assert.equal(repeated.status, 'already_applied');
  assert.equal(repeated.grantKey, first.grantKey);
  assert.equal(Object.hasOwn(repeated, 'nextState'), false);
  const recheck = recheckScoutXpLevelUp({
    proposal: first,
    currentStateSnapshot: first.nextState,
    grantKeyAlreadyCommitted: true
  });
  assert.equal(recheck.status, 'already_applied');
});

test('two workers must share optimistic revision and same-source uniqueness', () => {
  const first = quoteScoutXpLevelUp(xp());
  const second = quoteScoutXpLevelUp(xp());
  assert.deepEqual(
    recheckScoutXpLevelUp({
      proposal: first,
      currentStateSnapshot: state(),
      grantKeyAlreadyCommitted: false
    }),
    {
      status: 'preconditions_match_only',
      grantKey: first.grantKey,
      expectedRevision: 3,
      proposedRevision: 4
    }
  );
  assert.equal(
    recheckScoutXpLevelUp({
      proposal: second,
      currentStateSnapshot: first.nextState,
      grantKeyAlreadyCommitted: false
    }).status,
    'stale_state'
  );
});

test('a stale level XP or previous review checkpoint invalidates an XP proposal', () => {
  const proposal = quoteScoutXpLevelUp(xp());
  for (const current of [
    state({ revision: 4 }),
    state({ levelProgressXp: 21 }),
    state({ currentLevel: 69, highestLevel: 69, levelProgressXp: 0 }),
    state({ highestLevel: 70 }),
    state({ lastReviewedWindowEndMs: start + 30 * day })
  ]) {
    assert.equal(
      recheckScoutXpLevelUp({
        proposal,
        currentStateSnapshot: current,
        grantKeyAlreadyCommitted: false
      }).status,
      'stale_state'
    );
  }
});

test('unapproved or absent Lv.31-100 XP thresholds cannot be guessed', () => {
  for (const options of [
    { thresholdsApproved: false },
    { requiredXpByLevel: null },
    { requiredXpByLevel: {} }
  ]) {
    const result = quoteScoutXpLevelUp(xp(options));
    assert.notEqual(result.status, 'proposal_only');
    assert.equal(Object.hasOwn(result, 'nextState'), false);
  }
  const partial = quoteScoutXpLevelUp(
    xp({
      requiredXpByLevel: { 68: 100 }
    })
  );
  assert.equal(partial.status, 'threshold_missing');
  assert.equal(partial.blockedAtLevel, 69);
  assert.equal(Object.hasOwn(partial, 'nextState'), false);
});

test('an exact level boundary does not require the unknown NEXT threshold', () => {
  const result = quoteScoutXpLevelUp(
    xp({
      stateSnapshot: state({ levelProgressXp: 20 }),
      xpEvent: grant({ earnedXp: 80 }),
      requiredXpByLevel: { 68: 100 }
    })
  );
  assert.equal(result.status, 'proposal_only');
  assert.deepEqual(result.levelsGained, [69]);
  assert.equal(result.nextState.levelProgressXp, 0);
  assert.equal(result.nextState.currentLevel, 69);
});

test('an invalid current XP gauge is rejected before leveling', () => {
  const invalid = quoteScoutXpLevelUp(
    xp({
      stateSnapshot: state({ levelProgressXp: 100 })
    })
  );
  assert.equal(invalid.status, 'state_progress_inconsistent');
  assert.equal(Object.hasOwn(invalid, 'nextState'), false);
  assert.throws(
    () =>
      quoteScoutXpLevelUp(
        xp({
          requiredXpByLevel: { 68: 0 }
        })
      ),
    RangeError
  );
  assert.throws(
    () =>
      quoteScoutXpLevelUp(
        xp({
          requiredXpByLevel: { 68: -1 }
        })
      ),
    RangeError
  );
});

test('uncertain source evidence cannot change level progress', () => {
  for (const options of [
    { evidenceComplete: false },
    { alreadyAppliedToProgress: null }
  ]) {
    const result = quoteScoutXpLevelUp(xp(options));
    assert.equal(result.status, 'evidence_incomplete');
    assert.equal(Object.hasOwn(result, 'nextState'), false);
  }
  for (const evt of [
    grant({ userId: otherId }),
    grant({ sourceEventId: 'invalid' }),
    grant({ earnedXp: -1 }),
    grant({ earnedXp: 0 }),
    grant({ earnedXp: 1000001 }),
    grant({ earnedXp: '200' }),
    grant({ occurredAtMs: NaN }),
    grant({ xpKind: '' })
  ]) {
    assert.throws(() => quoteScoutXpLevelUp(xp({ xpEvent: evt })));
  }
});

test('before-release and review-due events are held, not silently processed', () => {
  const pre = quoteScoutXpLevelUp(
    xp({
      xpEvent: grant({ occurredAtMs: start - 1 })
    })
  );
  assert.equal(pre.status, 'outside_formal_release_window');
  const due = quoteScoutXpLevelUp(
    xp({
      xpEvent: grant({ occurredAtMs: start + 30 * day })
    })
  );
  assert.equal(due.status, 'review_checkpoint_due_first');
  assert.equal(Object.hasOwn(due, 'nextState'), false);
});

test('reaching Lv.100 exactly is allowed but surplus/at-cap XP remains undecided', () => {
  const nearly = state({
    currentLevel: 99,
    highestLevel: 99,
    levelProgressXp: 0
  });
  const exact = quoteScoutXpLevelUp(
    xp({
      stateSnapshot: nearly,
      xpEvent: grant({ earnedXp: 50 }),
      requiredXpByLevel: { 99: 50 }
    })
  );
  assert.equal(exact.status, 'proposal_only');
  assert.equal(exact.nextState.currentLevel, 100);
  assert.equal(exact.nextState.highestLevel, 100);
  assert.equal(exact.nextState.levelProgressXp, 0);
  const surplus = quoteScoutXpLevelUp(
    xp({
      stateSnapshot: nearly,
      xpEvent: grant({ earnedXp: 51 }),
      requiredXpByLevel: { 99: 50 }
    })
  );
  assert.equal(surplus.status, 'level_cap_policy_pending');
  assert.equal(Object.hasOwn(surplus, 'nextState'), false);
  const capped = quoteScoutXpLevelUp(
    xp({
      stateSnapshot: state({
        currentLevel: 100,
        highestLevel: 100,
        levelProgressXp: 0
      })
    })
  );
  assert.equal(capped.status, 'level_cap_policy_pending');
});

test('a 200 XP level-up still counts as 200 earned XP for the SAME review', () => {
  const first = state({
    currentLevel: 69,
    highestLevel: 69,
    levelProgressXp: 0
  });
  const gained = quoteScoutXpLevelUp(
    xp({
      stateSnapshot: first,
      xpEvent: grant({ earnedXp: 200 }),
      requiredXpByLevel: { 69: 200 }
    })
  );
  assert.equal(gained.status, 'proposal_only');
  assert.equal(gained.nextState.currentLevel, 70);
  assert.equal(gained.nextState.highestLevel, 70);
  assert.equal(gained.nextState.levelProgressXp, 0);
  const maintenance = review(gained.nextState, [ledgerRow(200)]);
  assert.equal(maintenance.status, 'quotation_only');
  assert.equal(maintenance.earnedXpInCompleted30DayWindow, 200);
  assert.equal(maintenance.metQuota, true);
  const next = quoteScoutReviewStateTransition({
    stateSnapshot: gained.nextState,
    reviewQuote: maintenance
  });
  assert.equal(next.status, 'proposal_only');
  assert.equal(next.nextState.currentLevel, 70);
  assert.equal(next.nextState.highestLevel, 70);
  assert.equal(next.nextState.lastReviewedWindowEndMs, start + 30 * day);
  assert.equal(next.nextState.revision, gained.nextState.revision + 1);
  assert.equal(next.nextState.levelProgressXp, 0);
  assert.equal(Object.hasOwn(next.nextState, 'lifetimeXp'), false);
});

test('the review proposal built BEFORE level-up is rejected AFTER level-up', () => {
  const initial = state();
  const dueBefore = quoteScoutReviewStateTransition({
    stateSnapshot: initial,
    reviewQuote: review(initial, [ledgerRow(200)])
  });
  assert.equal(dueBefore.status, 'proposal_only');
  const promoted = quoteScoutXpLevelUp(xp());
  assert.equal(
    recheckScoutReviewProposal({
      proposal: dueBefore,
      currentStateSnapshot: promoted.nextState,
      reviewKeyAlreadyCommitted: false
    }).status,
    'stale_state'
  );
});

test('after a review, XP in the next period can progress from the lower level', () => {
  const before = state({
    currentLevel: 69,
    highestLevel: 69,
    levelProgressXp: 45
  });
  const demotion = quoteScoutReviewStateTransition({
    stateSnapshot: before,
    reviewQuote: review(before, [])
  });
  assert.equal(demotion.status, 'proposal_only');
  assert.equal(demotion.nextState.currentLevel, 68);
  assert.equal(demotion.nextState.levelProgressXp, 0);
  const afterBoundary = quoteScoutXpLevelUp(
    xp({
      stateSnapshot: demotion.nextState,
      xpEvent: grant({ earnedXp: 50, occurredAtMs: start + 30 * day }),
      requiredXpByLevel: { 68: 100 }
    })
  );
  assert.equal(afterBoundary.status, 'proposal_only');
  assert.equal(afterBoundary.nextState.currentLevel, 68);
  assert.equal(afterBoundary.nextState.levelProgressXp, 50);
  assert.equal(
    afterBoundary.nextState.revision,
    demotion.nextState.revision + 1
  );
});

test('the lowest protected level retains its history while newly earned XP progresses', () => {
  const floor = state({
    currentLevel: 50,
    highestLevel: 70,
    levelProgressXp: 25
  });
  const plan = quoteScoutXpLevelUp(
    xp({
      stateSnapshot: floor,
      xpEvent: grant({ earnedXp: 20 }),
      requiredXpByLevel: { 50: 100 }
    })
  );
  assert.equal(plan.status, 'proposal_only');
  assert.equal(plan.nextState.currentLevel, 50);
  assert.equal(plan.nextState.levelProgressXp, 45);
  assert.equal(plan.nextState.highestLevel, 70);
});

test('review and XP progression both require the same revision-CAS', () => {
  const before = state();
  const proposal = quoteScoutXpLevelUp(xp());
  const reviewPlan = quoteScoutReviewStateTransition({
    stateSnapshot: before,
    reviewQuote: review(before, [ledgerRow(200)])
  });
  assert.equal(reviewPlan.status, 'proposal_only');
  assert.equal(
    recheckScoutXpLevelUp({
      proposal,
      currentStateSnapshot: reviewPlan.nextState,
      grantKeyAlreadyCommitted: false
    }).status,
    'stale_state'
  );
  assert.equal(
    recheckScoutReviewProposal({
      proposal: reviewPlan,
      currentStateSnapshot: proposal.nextState,
      reviewKeyAlreadyCommitted: false
    }).status,
    'stale_state'
  );
});

test('recheck requires a verified boolean for durable grant-key existence', () => {
  const plan = quoteScoutXpLevelUp(xp());
  assert.throws(
    () =>
      recheckScoutXpLevelUp({
        proposal: plan,
        currentStateSnapshot: state()
      }),
    TypeError
  );
  assert.throws(
    () =>
      recheckScoutXpLevelUp({
        proposal: { status: 'not_due' },
        currentStateSnapshot: state(),
        grantKeyAlreadyCommitted: false
      }),
    TypeError
  );
});

test('late XP from an already closed review window is held without state change', () => {
  const reviewed = state({
    lastReviewedWindowEndMs: start + 30 * day,
    revision: 4
  });
  for (const timestamp of [start, start + 30 * day - 1]) {
    const result = quoteScoutXpLevelUp(
      xp({
        stateSnapshot: reviewed,
        xpEvent: grant({ occurredAtMs: timestamp, earnedXp: 50 })
      })
    );
    assert.equal(result.status, 'closed_review_window');
    assert.equal(Object.hasOwn(result, 'nextState'), false);
  }
  const currentWindow = quoteScoutXpLevelUp(
    xp({
      stateSnapshot: reviewed,
      xpEvent: grant({ occurredAtMs: start + 30 * day, earnedXp: 50 })
    })
  );
  assert.equal(currentWindow.status, 'proposal_only');
  assert.equal(currentWindow.nextState.currentLevel, 68);
  assert.equal(currentWindow.nextState.levelProgressXp, 70);
});

test('existing DB scout_xp_ledger kind length, not a speculative kind allowlist, is used', () => {
  const atypicalButAllowedKind = quoteScoutXpLevelUp(
    xp({
      xpEvent: grant({ xpKind: 'discovery.bonus', earnedXp: 10 })
    })
  );
  assert.equal(atypicalButAllowedKind.status, 'proposal_only');
  assert.equal(atypicalButAllowedKind.nextState.levelProgressXp, 30);
});
