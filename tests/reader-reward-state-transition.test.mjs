import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteScoutMaintenanceReviewDryRun } from '../api/_lib/reader-reward/maintenance-review.js';
import {
  validateScoutLevelStateSnapshot,
  quoteScoutReviewStateTransition,
  recheckScoutReviewProposal
} from '../api/_lib/reader-reward/state-transition.js';

const day = 86400000;
const anchor = Date.UTC(2027, 2, 1, 12);
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherUser = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const state = (changes = {}) => ({
  userId,
  currentLevel: 90,
  highestLevel: 92,
  levelProgressXp: 425,
  reviewAnchorMs: anchor,
  lastReviewedWindowEndMs: null,
  revision: 9,
  ...changes
});
const xpEvent = (value) => ({
  id: '10000000-0000-4000-8000-000000000001',
  source_event_id: '20000000-0000-4000-8000-000000000001',
  user_id: userId,
  xp_kind: 'valid_read_episode',
  xp_value: value,
  occurred_at: new Date(anchor).toISOString()
});
const quote = (extra = {}) =>
  quoteScoutMaintenanceReviewDryRun({
    accountId: userId,
    firstWindowStartMs: anchor,
    reviewOrdinal: 1,
    asOfMs: anchor + 30 * day,
    lastReviewedWindowEndMs: null,
    ledgerSnapshotComplete: true,
    verifiedLedgerRows: [xpEvent(199)],
    currentLevel: 90,
    verifiedHistoricalMaxLevel: 92,
    currentLevelProgressXp: 425,
    ...extra
  });
const propose = (snap = state(), review = quote()) =>
  quoteScoutReviewStateTransition({
    stateSnapshot: snap,
    reviewQuote: review
  });

test('state snapshot keeps ONLY current level, XP progress, peak, anchor, checkpoint, revision', () => {
  const validated = validateScoutLevelStateSnapshot({
    ...state(),
    totalLifetimeXp: 1000000,
    clientAuthorization: 'ignored'
  });
  assert.deepEqual(validated, state());
  assert.equal(Object.hasOwn(validated, 'totalLifetimeXp'), false);
  assert.equal(Object.isFrozen(validated), true);
});

test('199 XP produces a versioned dry-run downgrade, zero XP progress and stable identity', () => {
  const plan = propose();
  assert.equal(plan.status, 'proposal_only');
  assert.equal(plan.reviewKey, quote().reviewKey);
  assert.deepEqual(plan.expectedState, state());
  assert.deepEqual(plan.nextState, {
    ...state(),
    currentLevel: 89,
    levelProgressXp: 0,
    lastReviewedWindowEndMs: anchor + 30 * day,
    revision: 10
  });
  assert.equal(plan.nextState.highestLevel, 92);
  assert.equal(Object.isFrozen(plan.nextState), true);
  assert.equal(Object.hasOwn(plan.nextState, 'lifetimeXp'), false);
});

test('200 XP maintains level and progress while checkpoint advances once', () => {
  const review = quote({ verifiedLedgerRows: [xpEvent(200)] });
  const plan = propose(state(), review);
  assert.equal(plan.nextState.currentLevel, 90);
  assert.equal(plan.nextState.levelProgressXp, 425);
  assert.equal(plan.nextState.revision, 10);
});

test('two workers quoting the same immutable state cannot reuse a checkpoint in recheck', () => {
  const workerA = propose();
  const workerB = propose();
  assert.deepEqual(
    recheckScoutReviewProposal({
      proposal: workerA,
      currentStateSnapshot: state(),
      reviewKeyAlreadyCommitted: false
    }),
    {
      status: 'preconditions_match_only',
      reviewKey: workerA.reviewKey,
      expectedRevision: 9,
      proposedRevision: 10
    }
  );
  const afterA = workerA.nextState;
  const duplicate = recheckScoutReviewProposal({
    proposal: workerB,
    currentStateSnapshot: afterA,
    reviewKeyAlreadyCommitted: true
  });
  assert.equal(duplicate.status, 'already_reviewed');
  const sameWindow = recheckScoutReviewProposal({
    proposal: workerB,
    currentStateSnapshot: afterA,
    reviewKeyAlreadyCommitted: false
  });
  assert.equal(sameWindow.status, 'already_reviewed');
});

test('concurrent level/XP changes invalidate old state snapshot before commit', () => {
  const plan = propose();
  for (const changed of [
    state({ revision: 10 }),
    state({ levelProgressXp: 430 }),
    state({ currentLevel: 91, highestLevel: 92 }),
    state({ highestLevel: 99 }),
    state({ reviewAnchorMs: anchor + day })
  ]) {
    const result = recheckScoutReviewProposal({
      proposal: plan,
      currentStateSnapshot: changed,
      reviewKeyAlreadyCommitted: false
    });
    assert.equal(result.status, 'stale_state');
  }
});

test('a quote made for stale level progress is rejected, even at same XP total', () => {
  const mismatched = propose(state({ levelProgressXp: 500 }));
  assert.equal(mismatched.status, 'quote_state_mismatch');
  const changedLevel = propose(state({ currentLevel: 91 }));
  assert.equal(changedLevel.status, 'quote_state_mismatch');
});

test('a review quote cannot be redirected to another user or different 30-day window', () => {
  assert.equal(
    propose(state({ userId: otherUser })).status,
    'review_identity_mismatch'
  );
  assert.equal(
    propose(state({ reviewAnchorMs: anchor + day })).status,
    'review_identity_mismatch'
  );
  assert.equal(
    propose(state(), { ...quote(), reviewKey: 'tampered' }).status,
    'review_identity_mismatch'
  );
  assert.equal(
    propose(state(), { ...quote(), windowEndMs: anchor + 60 * day }).status,
    'review_identity_mismatch'
  );
});

test('a missing review checkpoint cannot be skipped by requesting the second period', () => {
  const second = quoteScoutMaintenanceReviewDryRun({
    accountId: userId,
    firstWindowStartMs: anchor,
    reviewOrdinal: 2,
    asOfMs: anchor + 60 * day,
    lastReviewedWindowEndMs: anchor + 30 * day,
    ledgerSnapshotComplete: true,
    verifiedLedgerRows: [],
    currentLevel: 90,
    verifiedHistoricalMaxLevel: 92,
    currentLevelProgressXp: 425
  });
  assert.equal(propose(state(), second).status, 'checkpoint_mismatch');
  const proper = propose(
    state({ lastReviewedWindowEndMs: anchor + 30 * day }),
    second
  );
  assert.equal(proper.status, 'proposal_only');
  assert.equal(proper.nextState.lastReviewedWindowEndMs, anchor + 60 * day);
  assert.equal(proper.nextState.revision, 10);
});

test('previously completed periods are not proposed again', () => {
  const completedState = state({ lastReviewedWindowEndMs: anchor + 30 * day });
  assert.equal(propose(completedState).status, 'already_reviewed');
  const plan = propose();
  assert.equal(
    recheckScoutReviewProposal({
      proposal: plan,
      currentStateSnapshot: completedState,
      reviewKeyAlreadyCommitted: true
    }).status,
    'already_reviewed'
  );
});

test('unapproved corrections and missing evidence never produce a transition proposal', () => {
  for (const blocked of [
    quote({ ledgerSnapshotComplete: false }),
    quote({ asOfMs: anchor + 20 * day }),
    quote({
      verifiedLedgerRows: [
        xpEvent(200),
        {
          ...xpEvent(-1),
          id: '10000000-0000-4000-8000-000000000002',
          source_event_id: '20000000-0000-4000-8000-000000000002'
        }
      ]
    })
  ]) {
    assert.notEqual(blocked.status, 'quotation_only');
    const result = propose(state(), blocked);
    assert.equal(result.status, 'quote_not_eligible');
    assert.equal(Object.hasOwn(result, 'nextState'), false);
  }
});

test('Lv.50 protected floor preserves progress while advancing review state', () => {
  const protectedState = state({
    currentLevel: 50,
    highestLevel: 70,
    levelProgressXp: 130
  });
  const review = quote({
    currentLevel: 50,
    verifiedHistoricalMaxLevel: 70,
    currentLevelProgressXp: 130,
    verifiedLedgerRows: []
  });
  const plan = propose(protectedState, review);
  assert.equal(plan.status, 'proposal_only');
  assert.equal(plan.nextState.currentLevel, 50);
  assert.equal(plan.nextState.levelProgressXp, 130);
  assert.equal(plan.nextState.highestLevel, 70);
});

test('invalid, unverified and inconsistent level snapshots fail closed', () => {
  const invalid = [
    state({ userId: 'not-uuid' }),
    state({ currentLevel: 0 }),
    state({ currentLevel: 101 }),
    state({ highestLevel: 89 }),
    state({ levelProgressXp: -1 }),
    state({ levelProgressXp: '100' }),
    state({ reviewAnchorMs: -1 }),
    state({ lastReviewedWindowEndMs: anchor + day }),
    state({ lastReviewedWindowEndMs: anchor - day }),
    state({ currentLevel: 49, highestLevel: 70 }),
    state({ revision: Number.MAX_SAFE_INTEGER }),
    state({ revision: undefined })
  ];
  for (const snapshot of invalid) {
    assert.throws(() => validateScoutLevelStateSnapshot(snapshot));
    assert.throws(() => propose(snapshot));
  }
});

test('a forged quote with altered level, quota, or progress is rejected', () => {
  const good = quote();
  for (const altered of [
    { ...good, nextLevel: 95 },
    { ...good, nextLevelProgressXp: 99 },
    { ...good, metQuota: true },
    { ...good, shouldDemote: false },
    { ...good, earnedXpInCompleted30DayWindow: 200 }
  ]) {
    assert.equal(propose(state(), altered).status, 'quote_state_mismatch');
  }
});

test('recheck demands an explicit confirmed unique-key observation', () => {
  assert.throws(
    () =>
      recheckScoutReviewProposal({
        proposal: propose(),
        currentStateSnapshot: state()
      }),
    TypeError
  );
  assert.throws(
    () =>
      recheckScoutReviewProposal({
        proposal: { status: 'not_due' },
        currentStateSnapshot: state(),
        reviewKeyAlreadyCommitted: false
      }),
    TypeError
  );
});
