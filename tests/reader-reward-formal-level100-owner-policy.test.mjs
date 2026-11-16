import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteScoutOfflineBetaHandoff } from '../api/_lib/reader-reward/formal-cutover-offline.js';
import { createFormalOfflineIntegration } from '../api/_lib/reader-reward/formal-offline-integration.js';
await import('../assets/formal-scout-reward-client.js');

const userId = '00000000-0000-4000-8000-000000000401';
const operatorId = '00000000-0000-4000-8000-000000000403';
const betaLedgerId = '00000000-0000-4000-8000-000000000681';
const release = Date.parse('2026-12-01T00:00:00.000Z');
const monthEnd = '2026-12-31T00:00:00.000Z';
const thresholds = Array.from({ length: 30 }, (_, index) => {
  const level = index + 1;
  return {
    level,
    cumulative_xp:
      level === 1 ? 0 : (level - 1) * 50 + 10 * (level - 2) * (level - 1),
    rule_version: 'beta-2026-09-21'
  };
});
const fixtureXp = (id, sourceId, xp, occurredAt) => ({
  sourceFixtureVerified: true,
  verifiedXpLedgerRow: {
    id,
    user_id: userId,
    source_event_id: sourceId,
    xp_kind: 'discovery_success',
    xp_value: xp,
    occurred_at: occurredAt
  }
});
const reachCap = fixtureXp(
  '00000000-0000-4000-8000-000000000691',
  '00000000-0000-4000-8000-000000000692',
  1100,
  '2026-12-12T12:00:00.000Z'
);
const afterCap = fixtureXp(
  '00000000-0000-4000-8000-000000000693',
  '00000000-0000-4000-8000-000000000694',
  800,
  '2026-12-20T12:00:00.000Z'
);
function sandbox({
  level = 99,
  highestLevel = level,
  progressXp = 390,
  events = [reachCap, afterCap]
} = {}) {
  const opening = quoteScoutOfflineBetaHandoff({
    ledgerUnitVersion: 'beta_one_point_per_yen',
    betaThresholdRows: thresholds,
    formalReleaseAtMs: release,
    accounts: [
      {
        userId,
        accountCreatedAtMs: Date.parse('2026-10-01T00:00:00.000Z'),
        verifiedBetaLedgerXp: 9570,
        betaSummary: {
          level: 30,
          total_xp: 9570,
          xp_into_level: 0,
          xp_for_next_level: 0,
          beta_level_max: true
        }
      }
    ],
    canonicalLedgerRows: [
      {
        id: betaLedgerId,
        user_id: userId,
        event_key: 'beta:original:once',
        point_kind: 'badge',
        point_value: 10,
        status: 'confirmed',
        reversal_of: null
      }
    ]
  });
  assert.equal(opening.status, 'offline_handoff_quote_only');
  const synthetic = {
    ...opening,
    walletSeeds: opening.walletSeeds.map((seed) => ({
      ...seed,
      formalState: {
        ...seed.formalState,
        currentLevel: level,
        highestLevel,
        levelProgressXp: progressXp
      }
    }))
  };
  return createFormalOfflineIntegration({
    handoff: synthetic,
    betaThresholdRows: thresholds,
    operatorId,
    formalReleaseAtMs: release,
    syntheticNowIso: monthEnd,
    syntheticXpEvents: events,
    mockBudgets: {
      external_exchange: {
        scopeId: 'offline-level100-gift',
        limitPoints: 100000
      },
      ai_direct_use: { scopeId: 'offline-level100-ai', limitPoints: 100000 }
    }
  });
}

test('Lv99 to Lv100 with surplus: one initial 50 Point; full XP counts in maintenance and Wallet stays unique', async () => {
  const app = sandbox();
  const first = await app.applyCommittedXp({
    xpLedgerId: reachCap.verifiedXpLedgerRow.id
  });
  assert.equal(first.status, 'applied');
  assert.equal(first.level, 100);
  assert.equal(first.progressXp, 0);
  assert.deepEqual(first.levelsGained, [100]);
  assert.deepEqual(first.firstLevelsRewarded, [100]);
  assert.equal(first.pointsAwarded, 50);
  assert.equal(
    (
      await app.applyCommittedXp({
        xpLedgerId: reachCap.verifiedXpLedgerRow.id
      })
    ).status,
    'already_applied'
  );
  const second = await app.applyCommittedXp({
    xpLedgerId: afterCap.verifiedXpLedgerRow.id
  });
  assert.equal(second.status, 'applied');
  assert.equal(second.level, 100);
  assert.equal(second.progressXp, 0);
  assert.deepEqual(second.levelsGained, []);
  assert.deepEqual(second.firstLevelsRewarded, []);
  assert.equal(second.pointsAwarded, 0);

  const ui =
    globalThis.NovelightFormalRewardReaderBindings.createFormalReaderRewardBindings(
      {
        request: async (input) => (await app.readerRequest(userId, input)).body
      }
    );
  const beforeReview = await ui.fetchSnapshot();
  assert.equal(beforeReview.account.level, 100);
  assert.equal(beforeReview.account.highestLevel, 100);
  assert.equal(beforeReview.account.requiredXp, null);
  assert.equal(beforeReview.account.progressXp, 0);
  assert.equal(beforeReview.account.earnedXpInPeriod, 1900);
  assert.equal(beforeReview.wallet.availablePoints, 150);
  assert.equal(beforeReview.wallet.exchangeEligiblePoints, 50);
  assert.deepEqual(
    beforeReview.history
      .filter((row) => row.kind === 'level_up')
      .map((row) => row.points),
    [50]
  );
  assert.equal(
    new Set(beforeReview.history.map((row) => row.operationId)).size,
    beforeReview.history.length
  );

  const reviewed = await app.reviewDueSynthetic({ limit: 1 });
  assert.equal(reviewed.status, 'review_tick_completed');
  assert.equal(reviewed.reviewed, 1);
  assert.deepEqual(
    app.inspectSyntheticMaintenance().map((row) => ({
      xp: row.earnedXp,
      demoted: row.demoted,
      level: row.levelAfter
    })),
    [{ xp: 1900, demoted: false, level: 100 }]
  );
  const afterReview = await ui.fetchSnapshot();
  assert.equal(afterReview.account.level, 100);
  assert.equal(afterReview.wallet.availablePoints, 150);
  assert.equal(afterReview.wallet.exchangeEligiblePoints, 50);
  const dashboard = (
    await app.adminRequest({
      method: 'GET',
      query: { view: 'reward_overview' }
    })
  ).body;
  assert.equal(dashboard.issuedTotal, 50);
  assert.equal(dashboard.levelUpTotal, 50);
  assert.equal(dashboard.xpEarnedMonth, 1900);
  assert.equal(dashboard.maintenanceReviewed, 1);
  const cohort = await app.inspectSyntheticWalletCohort();
  assert.equal(cohort.observed.wallet_balance_mismatch_users, 0);
  assert.equal(cohort.observed.ledger_confirmed_net_points, 150);
});

test('XP already earned at Lv100 is applied once, advances revision and still prevents 30-day demotion', async () => {
  const app = sandbox({
    level: 100,
    highestLevel: 100,
    progressXp: 0
  });
  const claims = await Promise.all([
    app.applyCommittedXp({ xpLedgerId: reachCap.verifiedXpLedgerRow.id }),
    app.applyCommittedXp({ xpLedgerId: reachCap.verifiedXpLedgerRow.id })
  ]);
  assert.deepEqual(claims.map((claim) => claim.status).sort(), [
    'already_applied',
    'applied'
  ]);
  const next = await app.resumePendingSyntheticXp({ userId });
  assert.equal(next.status, 'caught_up');
  assert.equal(next.xpApplied, 1);
  assert.equal(next.reviews, 1);
  const snapshot = (
    await app.readerRequest(userId, {
      method: 'GET'
    })
  ).body;
  assert.equal(snapshot.account.level, 100);
  assert.equal(snapshot.account.highestLevel, 100);
  assert.equal(snapshot.account.progressXp, 0);
  assert.equal(snapshot.wallet.availablePoints, 100);
  assert.equal(snapshot.wallet.exchangeEligiblePoints, 0);
  assert.equal(
    snapshot.history.filter((row) => row.kind === 'level_up').length,
    0
  );
  assert.equal(app.inspectSyntheticMaintenance()[0].earnedXp, 1900);
  const replay = await app.resumePendingSyntheticXp({ userId });
  assert.deepEqual(replay, {
    status: 'caught_up',
    xpApplied: 0,
    reviews: 0
  });
  assert.equal(app.inspectSyntheticMaintenance().length, 1);
});

test('inconsistent Lv100 progress is rejected without Point, state or XP claim mutation', async () => {
  const app = sandbox({
    level: 100,
    highestLevel: 100,
    progressXp: 7,
    events: [reachCap]
  });
  const result = await app.applyCommittedXp({
    xpLedgerId: reachCap.verifiedXpLedgerRow.id
  });
  assert.equal(result.status, 'state_progress_inconsistent');
  const snapshot = (
    await app.readerRequest(userId, {
      method: 'GET'
    })
  ).body;
  assert.equal(snapshot.account.level, 100);
  assert.equal(snapshot.account.progressXp, 7);
  assert.equal(snapshot.wallet.availablePoints, 100);
  assert.equal(snapshot.wallet.exchangeEligiblePoints, 0);
  assert.equal(
    (
      await app.applyCommittedXp({
        xpLedgerId: reachCap.verifiedXpLedgerRow.id
      })
    ).status,
    'state_progress_inconsistent'
  );
});
