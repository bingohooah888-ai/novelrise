import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SCOUT_POINTS_PER_YEN,
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
  amountPoints: 30000,
  availablePoints: 50000,
  balanceRevision: 15,
  authoritativeBalanceVerified: true,
  riskAndControlsCleared: true,
  duplicateOperationVerified: true,
  operationAlreadyCommitted: false,
  channelPolicyVerified: true,
  aiPriceApproved: true,
  ...changes
});

test('owner exchange policy: 10 Scout Point = ¥1 and 30000 Point external minimum', () => {
  assert.equal(SCOUT_POINT_YEN_VALUE, 0.1);
  assert.equal(SCOUT_POINTS_PER_YEN, 10);
  assert.equal(SCOUT_POINT_MIN_EXTERNAL_EXCHANGE, 30000);
  assert.equal(
    quoteScoutPointUsage(spend({ amountPoints: 29990 })).status,
    'below_exchange_minimum'
  );
  const result = quoteScoutPointUsage(spend());
  assert.equal(result.status, 'usage_quote_only');
  assert.equal(result.amountPoints, 30000);
  assert.equal(result.yenEquivalent, 3000);
  assert.equal(result.yenEquivalentTenths, 30000);
  assert.equal(result.proposedRemainingPoints, 20000);
  assert.equal(result.maySpendOrPayOut, false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(
    quoteScoutPointUsage(spend({ amountPoints: 30010 })).status,
    'usage_quote_only'
  );
});

test('AI spends SCOUT Point directly, with no 3000pt minimum or AI-credit minting', () => {
  for (const amount of [1, 2, 25, 29990]) {
    const result = quoteScoutPointUsage(
      spend({
        purpose: 'ai_direct_use',
        amountPoints: amount
      })
    );
    assert.equal(result.status, 'usage_quote_only');
    assert.equal(result.amountPoints, amount);
    assert.equal(result.yenEquivalent, amount / 10);
    assert.equal(result.yenEquivalentTenths, amount);
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
      amountPoints: 30000,
      availablePoints: 45000,
      balanceRevision: 17
    })
  );
  const ai = quoteScoutPointUsage(
    spend({
      operationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      purpose: 'ai_direct_use',
      amountPoints: 20000,
      availablePoints: 45000,
      balanceRevision: 17
    })
  );
  assert.equal(exchange.status, 'usage_quote_only');
  assert.equal(ai.status, 'usage_quote_only');
  const afterExchange = recheckScoutPointUsage({
    quote: ai,
    observedBalanceRevision: 18,
    observedAvailablePoints: 15000,
    operationAlreadyCommitted: false
  });
  assert.equal(afterExchange.status, 'stale_wallet');
  assert.equal(Object.hasOwn(afterExchange, 'maySpendOrPayOut'), false);
  assert.equal(
    recheckScoutPointUsage({
      quote: exchange,
      observedBalanceRevision: 17,
      observedAvailablePoints: 45000,
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
    observedAvailablePoints: 20000,
    operationAlreadyCommitted: true
  });
  assert.equal(replay.status, 'already_processed');
  assert.equal(
    recheckScoutPointUsage({
      quote: p,
      observedBalanceRevision: 15,
      observedAvailablePoints: 40000,
      operationAlreadyCommitted: false
    }).status,
    'stale_wallet'
  );
  assert.equal(
    recheckScoutPointUsage({
      quote: p,
      observedBalanceRevision: 16,
      observedAvailablePoints: 50000,
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
      availablePoints: 5000,
      amountPoints: 30000
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
      observedAvailablePoints: 50000,
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
    { amountPoints: '30000' },
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
        observedAvailablePoints: 50000
      }),
    TypeError
  );
});

test('reaching a Level grants 50pt once, including newly unlocked 100; re-ascending grants zero', () => {
  assert.equal(SCOUT_LEVEL_UP_POINTS, 50);
  const first = quoteScoutMilestonePointGrant(grant({ reachedLevel: 30 }));
  assert.equal(first.status, 'grant_quote_only');
  assert.equal(first.eventKey, 'level_up:' + userId + ':30');
  assert.equal(first.points, 50);
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
  assert.equal(top.points, 50);
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
  assert.equal(lvl31.points, 50);
  assert.equal(previouslyGranted.length * 50, 1450);
  assert.equal(99 * 50, 4950);
});

test('reader badge points use existing badge unique key, author badges are not payable', () => {
  const badge = quoteScoutMilestonePointGrant(
    grant({
      kind: 'reader_badge',
      reachedLevel: null,
      badgeId: 'reader_book_001',
      readerBadgePointReward: 250,
      readerBadgeDefinitionVerified: true
    })
  );
  assert.equal(badge.status, 'grant_quote_only');
  assert.equal(badge.eventKey, 'badge:' + userId + ':reader_book_001');
  assert.equal(badge.kind, 'badge');
  assert.equal(badge.points, 250);
  const repeat = quoteScoutMilestonePointGrant(
    grant({
      kind: 'reader_badge',
      badgeId: 'reader_book_001',
      readerBadgePointReward: 250,
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
        readerBadgePointReward: 250
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

test('8350 total badge reward remains observed-only theoretical max, not a forced grant', () => {
  assert.equal(SCOUT_READER_BADGE_DEFINED_MAX_POINTS, 8350);
  const byDifficulty = [300, 3050, 5000];
  assert.equal(
    byDifficulty.reduce((a, b) => a + b, 0),
    8350
  );
  assert.equal(8350 + 4950, 13300);
  assert.equal(13300 < SCOUT_POINT_MIN_EXTERNAL_EXCHANGE, true);
  assert.equal(2530 + 1450, 3980);
});

test('0.1 yen corresponds to one integer Scout Point with no rounding', () => {
  for (const tenths of [1, 2, 9, 10, 11, 20]) {
    assert.deepEqual(quoteScoutTenthsYenAsPoints(tenths), {
      status: 'exact_integer_quote_only',
      points: tenths,
      amountTenthsYen: tenths,
      mayIssuePoints: false
    });
  }
  for (const bad of [-1, 0.5, '10', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => quoteScoutTenthsYenAsPoints(bad), RangeError);
  }
});
