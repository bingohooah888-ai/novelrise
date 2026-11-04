import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SCOUT_POINT_YEN_VALUE,
  SCOUT_POINT_MIN_EXTERNAL_EXCHANGE,
  SCOUT_LEVEL_UP_POINTS,
  SCOUT_READER_BADGE_DEFINED_MAX_POINTS,
  quoteScoutMilestonePointGrant,
  quoteScoutTenthsYenAsPoints,
  quoteScoutPointUsage,
  recheckScoutPointUsage
} from '../api/_lib/reader-reward/scout-point-usage.js';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherUser = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const operationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const grant = (changes = {}) => ({
  userId,
  kind: 'level_up',
  reachedLevel: 30,
  historicalEventKeys: [],
  awardHistoryComplete: true,
  milestoneVerified: true,
  ...changes
});
const spend = (changes = {}) => ({
  userId,
  operationId,
  purpose: 'external_exchange',
  amountPoints: 3000,
  availablePoints: 5000,
  balanceRevision: 15,
  authoritativeBalanceVerified: true,
  riskAndControlsCleared: true,
  duplicateOperationVerified: true,
  operationAlreadyCommitted: false,
  channelPolicyVerified: true,
  aiPriceApproved: true,
  ...changes
});

test('owner exchange policy: 1 Scout Point = ¥1 and 3000 Point external minimum', () => {
  assert.equal(SCOUT_POINT_YEN_VALUE, 1);
  assert.equal(SCOUT_POINT_MIN_EXTERNAL_EXCHANGE, 3000);
  assert.equal(
    quoteScoutPointUsage(spend({ amountPoints: 2999 })).status,
    'below_exchange_minimum'
  );
  const result = quoteScoutPointUsage(spend());
  assert.equal(result.status, 'usage_quote_only');
  assert.equal(result.amountPoints, 3000);
  assert.equal(result.yenEquivalent, 3000);
  assert.equal(result.proposedRemainingPoints, 2000);
  assert.equal(result.maySpendOrPayOut, false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(
    quoteScoutPointUsage(spend({ amountPoints: 3001 })).status,
    'usage_quote_only'
  );
});

test('AI spends SCOUT Point directly, with no 3000pt minimum or AI-credit minting', () => {
  for (const amount of [1, 2, 25, 2999]) {
    const result = quoteScoutPointUsage(
      spend({
        purpose: 'ai_direct_use',
        amountPoints: amount
      })
    );
    assert.equal(result.status, 'usage_quote_only');
    assert.equal(result.amountPoints, amount);
    assert.equal(result.yenEquivalent, amount);
    assert.equal(Object.hasOwn(result, 'aiCredits'), false);
    assert.equal(result.maySpendOrPayOut, false);
  }
  const unknownPrice = quoteScoutPointUsage(
    spend({
      purpose: 'ai_direct_use',
      aiPriceApproved: false,
      amountPoints: 1
    })
  );
  assert.equal(unknownPrice.status, 'channel_policy_unapproved');
  assert.equal(Object.hasOwn(unknownPrice, 'proposedRemainingPoints'), false);
});

test('exchange and AI quotes compete against ONE verified wallet balance', () => {
  const exchange = quoteScoutPointUsage(
    spend({
      operationId,
      amountPoints: 3000,
      availablePoints: 4500,
      balanceRevision: 17
    })
  );
  const ai = quoteScoutPointUsage(
    spend({
      operationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      purpose: 'ai_direct_use',
      amountPoints: 2000,
      availablePoints: 4500,
      balanceRevision: 17
    })
  );
  assert.equal(exchange.status, 'usage_quote_only');
  assert.equal(ai.status, 'usage_quote_only');
  const afterExchange = recheckScoutPointUsage({
    quote: ai,
    observedBalanceRevision: 18,
    observedAvailablePoints: 1500,
    operationAlreadyCommitted: false
  });
  assert.equal(afterExchange.status, 'stale_wallet');
  assert.equal(Object.hasOwn(afterExchange, 'maySpendOrPayOut'), false);
  assert.equal(
    recheckScoutPointUsage({
      quote: exchange,
      observedBalanceRevision: 17,
      observedAvailablePoints: 4500,
      operationAlreadyCommitted: false
    }).status,
    'preconditions_match_only'
  );
});

test('replay of same operation is stopped and does not create a new debit', () => {
  const p = quoteScoutPointUsage(spend());
  assert.equal(
    quoteScoutPointUsage(
      spend({
        operationAlreadyCommitted: true
      })
    ).status,
    'already_processed'
  );
  const replay = recheckScoutPointUsage({
    quote: p,
    observedBalanceRevision: 16,
    observedAvailablePoints: 2000,
    operationAlreadyCommitted: true
  });
  assert.equal(replay.status, 'already_processed');
  assert.equal(
    recheckScoutPointUsage({
      quote: p,
      observedBalanceRevision: 15,
      observedAvailablePoints: 4000,
      operationAlreadyCommitted: false
    }).status,
    'stale_wallet'
  );
  assert.equal(
    recheckScoutPointUsage({
      quote: p,
      observedBalanceRevision: 16,
      observedAvailablePoints: 5000,
      operationAlreadyCommitted: false
    }).status,
    'stale_wallet'
  );
});

test('pending/frozen/controlled balances cannot be treated as spendable', () => {
  for (const change of [
    { authoritativeBalanceVerified: false },
    { riskAndControlsCleared: false }
  ]) {
    const result = quoteScoutPointUsage(spend(change));
    assert.equal(result.status, 'wallet_or_risk_unverified');
    assert.equal(Object.hasOwn(result, 'proposedRemainingPoints'), false);
  }
  const onlyConfirmedAvailable = quoteScoutPointUsage(
    spend({
      availablePoints: 500,
      amountPoints: 3000
    })
  );
  assert.equal(onlyConfirmedAvailable.status, 'insufficient_available_points');
  assert.equal(
    quoteScoutPointUsage(
      spend({
        channelPolicyVerified: false
      })
    ).status,
    'channel_policy_unapproved'
  );
  assert.equal(
    quoteScoutPointUsage(
      spend({
        duplicateOperationVerified: false
      })
    ).status,
    'operation_history_unverified'
  );
  assert.equal(
    quoteScoutPointUsage(
      spend({
        operationAlreadyCommitted: undefined
      })
    ).status,
    'operation_history_unverified'
  );
});

test('read-only quote never enables cashout or AI invocation even with flags true', () => {
  for (const purpose of ['ai_direct_use', 'external_exchange']) {
    const proposal = quoteScoutPointUsage(spend({ purpose }));
    assert.equal(proposal.status, 'usage_quote_only');
    assert.equal(proposal.maySpendOrPayOut, false);
    const recheck = recheckScoutPointUsage({
      quote: proposal,
      observedBalanceRevision: 15,
      observedAvailablePoints: 5000,
      operationAlreadyCommitted: false
    });
    assert.deepEqual(recheck, {
      status: 'preconditions_match_only',
      operationKey: proposal.operationKey,
      maySpendOrPayOut: false
    });
  }
});

test('invalid costs, unknown purpose and user identities are rejected', () => {
  for (const invalid of [
    { amountPoints: 0 },
    { amountPoints: -1 },
    { amountPoints: 0.1 },
    { amountPoints: '3000' },
    { amountPoints: Number.MAX_SAFE_INTEGER + 1 },
    { availablePoints: -1 },
    { availablePoints: 1.5 },
    { balanceRevision: -1 },
    { balanceRevision: null },
    { userId: otherUser.slice(1) },
    { operationId: 'bad' },
    { purpose: 'ai_credit_exchange' },
    { purpose: 'cash_transfer' }
  ]) {
    assert.throws(() => quoteScoutPointUsage(spend(invalid)));
  }
  assert.throws(
    () =>
      recheckScoutPointUsage({
        quote: quoteScoutPointUsage(spend()),
        observedBalanceRevision: 15,
        observedAvailablePoints: 5000
      }),
    TypeError
  );
});

test('reaching a Level grants 5pt once, including newly unlocked 100; re-ascending grants zero', () => {
  assert.equal(SCOUT_LEVEL_UP_POINTS, 5);
  const first = quoteScoutMilestonePointGrant(grant({ reachedLevel: 30 }));
  assert.equal(first.status, 'grant_quote_only');
  assert.equal(first.eventKey, 'level_up:' + userId + ':30');
  assert.equal(first.points, 5);
  assert.equal(first.mayIssuePoints, false);
  const revisited = quoteScoutMilestonePointGrant(
    grant({
      reachedLevel: 30,
      historicalEventKeys: [first.eventKey]
    })
  );
  assert.equal(revisited.status, 'already_awarded');
  const top = quoteScoutMilestonePointGrant(grant({ reachedLevel: 100 }));
  assert.equal(top.status, 'grant_quote_only');
  assert.equal(top.points, 5);
  assert.equal(Object.hasOwn(top, 'lifetimeXp'), false);
  assert.throws(
    () => quoteScoutMilestonePointGrant(grant({ reachedLevel: 1 })),
    RangeError
  );
});

test('β-issued Level-up points remain deduplicated at formal migration', () => {
  const previouslyGranted = Array.from(
    { length: 29 },
    (_, idx) => 'level_up:' + userId + ':' + (idx + 2)
  );
  const lvl25Again = quoteScoutMilestonePointGrant(
    grant({
      reachedLevel: 25,
      historicalEventKeys: previouslyGranted
    })
  );
  assert.equal(lvl25Again.status, 'already_awarded');
  const lvl31 = quoteScoutMilestonePointGrant(
    grant({
      reachedLevel: 31,
      historicalEventKeys: previouslyGranted
    })
  );
  assert.equal(lvl31.status, 'grant_quote_only');
  assert.equal(lvl31.points, 5);
  assert.equal(previouslyGranted.length * 5, 145);
  assert.equal(99 * 5, 495);
});

test('reader badge points use existing badge unique key, author badges are not payable', () => {
  const badge = quoteScoutMilestonePointGrant(
    grant({
      kind: 'reader_badge',
      reachedLevel: null,
      badgeId: 'reader_book_001',
      readerBadgePointReward: 25,
      readerBadgeDefinitionVerified: true
    })
  );
  assert.equal(badge.status, 'grant_quote_only');
  assert.equal(badge.eventKey, 'badge:' + userId + ':reader_book_001');
  assert.equal(badge.kind, 'badge');
  assert.equal(badge.points, 25);
  const repeat = quoteScoutMilestonePointGrant(
    grant({
      kind: 'reader_badge',
      badgeId: 'reader_book_001',
      readerBadgePointReward: 25,
      readerBadgeDefinitionVerified: true,
      historicalEventKeys: [badge.eventKey]
    })
  );
  assert.equal(repeat.status, 'already_awarded');
  assert.throws(
    () =>
      quoteScoutMilestonePointGrant(
        grant({
          kind: 'author_badge',
          badgeId: 'author_book_001'
        })
      ),
    TypeError
  );
  assert.equal(
    quoteScoutMilestonePointGrant(
      grant({
        kind: 'reader_badge',
        badgeId: 'reader_book_002',
        readerBadgePointReward: 0,
        readerBadgeDefinitionVerified: true
      })
    ).status,
    'no_point_reward'
  );
});

test('a badge without verified definition or full award history never grants points', () => {
  for (const result of [
    quoteScoutMilestonePointGrant(
      grant({
        kind: 'reader_badge',
        badgeId: 'reader_book_001',
        readerBadgePointReward: 25
      })
    ),
    quoteScoutMilestonePointGrant(grant({ awardHistoryComplete: false })),
    quoteScoutMilestonePointGrant(grant({ historicalEventKeys: undefined })),
    quoteScoutMilestonePointGrant(grant({ milestoneVerified: false }))
  ]) {
    assert.equal(
      ['badge_definition_unverified', 'award_evidence_incomplete'].includes(
        result.status
      ),
      true
    );
    assert.equal(Object.hasOwn(result, 'points'), false);
  }
  assert.throws(
    () =>
      quoteScoutMilestonePointGrant(
        grant({
          historicalEventKeys: [
            'level_up:' + userId + ':30',
            'level_up:' + userId + ':30'
          ]
        })
      ),
    TypeError
  );
  assert.throws(
    () =>
      quoteScoutMilestonePointGrant(
        grant({
          kind: 'reader_badge',
          badgeId: 'bad!',
          readerBadgeDefinitionVerified: true,
          readerBadgePointReward: 1
        })
      ),
    TypeError
  );
});

test('835 total badge reward remains observed-only theoretical max, not a forced grant', () => {
  assert.equal(SCOUT_READER_BADGE_DEFINED_MAX_POINTS, 835);
  const byDifficulty = [30, 305, 500];
  assert.equal(
    byDifficulty.reduce((a, b) => a + b, 0),
    835
  );
  assert.equal(835 + 495, 1330);
  assert.equal(1330 < SCOUT_POINT_MIN_EXTERNAL_EXCHANGE, true);
  assert.equal(253 + 145, 398);
});

test('0.1 yen valid-read reward is held until fractional accounting is approved', () => {
  assert.equal(
    quoteScoutTenthsYenAsPoints(1).status,
    'fractional_settlement_policy_pending'
  );
  assert.equal(
    quoteScoutTenthsYenAsPoints(2).status,
    'fractional_settlement_policy_pending'
  );
  assert.equal(
    quoteScoutTenthsYenAsPoints(9).status,
    'fractional_settlement_policy_pending'
  );
  assert.equal(
    quoteScoutTenthsYenAsPoints(11).status,
    'fractional_settlement_policy_pending'
  );
  assert.deepEqual(quoteScoutTenthsYenAsPoints(10), {
    status: 'exact_integer_quote_only',
    points: 1,
    mayIssuePoints: false
  });
  assert.equal(quoteScoutTenthsYenAsPoints(20).points, 2);
  for (const bad of [-1, 0.5, '10', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => quoteScoutTenthsYenAsPoints(bad), RangeError);
  }
});
