import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCOUT_MIXED_BETA_POINT_UNITS,
  quoteScoutOfflineBetaHandoff,
  reconcileScoutOfflineOpening
} from '../api/_lib/reader-reward/formal-cutover-offline.js';
import { createFormalOfflineIntegration } from '../api/_lib/reader-reward/formal-offline-integration.js';
await import('../assets/formal-scout-reward-admin.js');
await import('../assets/formal-scout-reward-client.js');

const reader = '00000000-0000-4000-8000-000000000401';
const second = '00000000-0000-4000-8000-000000000402';
const operator = '00000000-0000-4000-8000-000000000403';
const sourceA = '00000000-0000-4000-8000-000000000591';
const sourceReverse = '00000000-0000-4000-8000-000000000592';
const sourceB = '00000000-0000-4000-8000-000000000593';
const sourceC = '00000000-0000-4000-8000-000000000594';
const aiOperation = '00000000-0000-4000-8000-000000000595';
const giftOperation = '00000000-0000-4000-8000-000000000596';
const release = Date.parse('2026-12-01T00:00:00.000Z');
const oldUnit = 'beta_one_point_per_yen';
const newUnit = 'beta_ten_points_per_yen';
const thresholds = Array.from({ length: 30 }, (_, index) => {
  const level = index + 1;
  return {
    level,
    cumulative_xp:
      level === 1 ? 0 : (level - 1) * 50 + 10 * (level - 2) * (level - 1),
    rule_version: 'beta-2026-09-21'
  };
});
const summary = {
  level: 30,
  total_xp: 9570,
  xp_into_level: 0,
  xp_for_next_level: 0,
  beta_level_max: true
};
const rows = [
  {
    id: sourceA,
    user_id: reader,
    event_key: 'badge:' + reader + ':reader_first_story_01',
    point_kind: 'badge',
    point_value: 400,
    sourceUnitVersion: oldUnit,
    status: 'confirmed',
    reversal_of: null
  },
  {
    id: sourceReverse,
    user_id: reader,
    event_key: 'beta:badge-reversal',
    point_kind: 'adjustment',
    point_value: -50,
    sourceUnitVersion: oldUnit,
    status: 'confirmed',
    reversal_of: sourceA
  },
  {
    id: sourceB,
    user_id: reader,
    event_key: 'badge:' + reader + ':reader_five_stories_01',
    point_kind: 'badge',
    point_value: 500,
    sourceUnitVersion: newUnit,
    status: 'confirmed',
    reversal_of: null
  },
  {
    id: sourceC,
    user_id: second,
    event_key: 'badge:' + second + ':reader_first_story_01',
    point_kind: 'badge',
    point_value: 300,
    sourceUnitVersion: oldUnit,
    status: 'confirmed',
    reversal_of: null
  }
];
const badges = [
  {
    userId: reader,
    badgeId: 'reader_first_story_01',
    status: 'earned',
    pointReward: 4000,
    sourceFixtureVerified: true
  },
  {
    userId: reader,
    badgeId: 'reader_five_stories_01',
    status: 'earned',
    pointReward: 500,
    sourceFixtureVerified: true
  },
  {
    userId: second,
    badgeId: 'reader_first_story_01',
    status: 'earned',
    pointReward: 3000,
    sourceFixtureVerified: true
  },
  {
    userId: reader,
    badgeId: 'reader_baseline_01',
    status: 'earned',
    pointReward: 0,
    sourceFixtureVerified: true
  },
  {
    userId: reader,
    badgeId: 'reader_missing_reward_01',
    status: 'earned',
    pointReward: 100,
    sourceFixtureVerified: true
  }
];
const accounts = [reader, second].map((userId) => ({
  userId,
  accountCreatedAtMs: Date.parse('2026-10-01T00:00:00.000Z'),
  verifiedBetaLedgerXp: 9570,
  betaSummary: summary
}));
const clone = (value) => JSON.parse(JSON.stringify(value));
function quoted(sourceRows = rows) {
  return quoteScoutOfflineBetaHandoff({
    ledgerUnitVersion: SCOUT_MIXED_BETA_POINT_UNITS,
    canonicalLedgerRows: clone(sourceRows),
    accounts: clone(accounts),
    betaThresholdRows: thresholds,
    formalReleaseAtMs: release
  });
}
function offline({
  sourceRows = rows,
  badgeRows = badges,
  formalPoints = 0,
  aiPrice = 4100
} = {}) {
  const handoff = quoted(sourceRows);
  assert.equal(handoff.status, 'offline_handoff_quote_only');
  return createFormalOfflineIntegration({
    handoff,
    betaThresholdRows: thresholds,
    operatorId: operator,
    mockBudgets: {
      external_exchange: { scopeId: 'synthetic-gift', limitPoints: 100000 },
      ai_direct_use: { scopeId: 'synthetic-ai', limitPoints: 100000 }
    },
    mockAiCatalog: [
      { id: 'analysis', name: '架空作品分析', pricePoints: aiPrice, approved: true }
    ],
    syntheticPostReleasePoints: formalPoints
      ? [
          {
            eventId: 'offline-formal:qualified-credit',
            userId: reader,
            amountPoints: formalPoints
          }
        ]
      : [],
    syntheticBadgeHistory: badgeRows
  });
}

test('beta legacy rows convert once, already-tenfold rows stay intact and Wallet matches canonical net', async () => {
  const handoff = quoted();
  assert.equal(handoff.summary.legacyRowsConverted, 3);
  assert.equal(handoff.summary.alreadyTenfoldRowsPreserved, 1);
  assert.deepEqual(
    handoff.convertedRows.map((entry) => entry.convertedValue),
    [4000, -500, 500, 3000]
  );
  assert.equal(handoff.summary.convertedConfirmedNet, 7000);
  assert.equal(handoff.walletSeeds[0].availablePoints, 4000);
  assert.equal(handoff.walletSeeds[1].availablePoints, 3000);
  assert.ok(handoff.walletSeeds.every((user) => user.exchangeEligiblePoints === 0));
  assert.equal(
    reconcileScoutOfflineOpening({
      handoff,
      convertedLedgerRows: handoff.convertedRows
    }).status,
    'offline_opening_reconciled'
  );
  // Pure quotation has no migration side effects: repeating the same source
  // cannot issue, or compound 10x on, any canonical row.
  assert.deepEqual(quoted().convertedRows, handoff.convertedRows);
  const sandbox = offline();
  const first = await sandbox.readerRequest(reader, { method: 'GET' });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.wallet.availablePoints, 4000);
  assert.equal(first.body.wallet.exchangeEligiblePoints, 0);
  assert.deepEqual(
    first.body.history.map((entry) => entry.points),
    [4000, -500, 500]
  );
  assert.equal(
    new Set(first.body.history.map((entry) => entry.operationId)).size,
    first.body.history.length
  );
  const cohort = (await sandbox.adminRequest({
    method: 'GET',
    query: { view: 'wallet_cohort' }
  })).body;
  assert.equal(cohort.status, 'formal_wallet_cohort_review_only');
  assert.equal(cohort.observed.wallet_users, 2);
  assert.equal(cohort.observed.ledger_users, 2);
  assert.equal(cohort.observed.wallet_balance_mismatch_users, 0);
  assert.equal(cohort.observed.wallet_available_points, 7000);
  assert.equal(cohort.observed.ledger_confirmed_net_points, 7000);
  assert.equal(cohort.observed.wallet_eligible_points, 0);
  assert.equal(cohort.readyForPublicRelease, false);
  assert.equal(cohort.mayWriteDb, false);
});

test('badge history reports old/current unit claims, baseline and missing rewards without paying twice', async () => {
  const sandbox = offline();
  const admin = globalThis.NovelightFormalRewardAdmin.createFormalAdminBindings({
    request: async (input) => (await sandbox.adminRequest(input)).body
  });
  const report = await admin.loadBadgeHistory();
  assert.equal(report.status, 'formal_badge_history_review_only');
  assert.equal(report.observed.earned_badges, 5);
  assert.equal(report.observed.linked_events, 3);
  assert.equal(report.observed.legacy_unit_events, 2);
  assert.equal(report.observed.current_unit_events, 1);
  assert.equal(report.observed.earned_without_event, 1);
  assert.equal(report.observed.orphan_reader_badge_events, 0);
  assert.equal(report.historicalMissingPointsMayBeBackfilled, false);
  assert.equal(report.mayIssuePoints, false);
  assert.equal(report.readyForPublicRelease, false);
  assert.ok(report.blockers.includes('beta_point_10x_cutover_not_verified'));
  assert.ok(report.blockers.includes('earned_without_point_event_requires_manual_review'));
  assert.equal(JSON.stringify(report).includes(reader), false);
  assert.equal(JSON.stringify(report).includes(sourceA), false);

  const after = await sandbox.readerRequest(reader, { method: 'GET' });
  assert.equal(after.body.wallet.availablePoints, 4000);
  assert.equal(after.body.wallet.exchangeEligiblePoints, 0);
  assert.equal(after.body.history.length, 3);
  const duplicate = [...badges, clone(badges[0])];
  assert.throws(() => offline({ badgeRows: duplicate }), TypeError);
});

test('gift exchange rejects beta balances even when total Points are sufficient', async () => {
  const sandbox = offline({ formalPoints: 200 });
  const exchange = await sandbox.readerRequest(reader, {
    method: 'POST',
    body: {
      action: 'exchange_request',
      operationId: giftOperation,
      amountPoints: 30000
    }
  });
  assert.equal(exchange.statusCode, 409);
  assert.equal(exchange.body.error, 'insufficient_exchange_eligible_points');
  const snapshot = (await sandbox.readerRequest(reader, { method: 'GET' })).body;
  assert.equal(snapshot.wallet.availablePoints, 4200);
  assert.equal(snapshot.wallet.exchangeEligiblePoints, 200);
  const cohort = await sandbox.inspectSyntheticWalletCohort();
  assert.equal(cohort.observed.wallet_balance_mismatch_users, 0);
  assert.equal(cohort.observed.wallet_eligible_points, 200);
  assert.equal(cohort.observed.ledger_confirmed_net_points, 7200);
  assert.equal(sandbox.mockGiftVerifications, 0);
});

test('AI uses beta Point before new formal Point and idempotent refund restores exact allocation', async () => {
  const sandbox = offline({ formalPoints: 200 });
  const bridge =
    globalThis.NovelightFormalRewardReaderBindings.createFormalReaderRewardBindings({
      request: async (input) => (await sandbox.readerRequest(reader, input)).body,
      nextOperationId: () => aiOperation
    });
  const before = await bridge.fetchSnapshot();
  assert.equal(before.wallet.availablePoints, 4200);
  assert.equal(before.wallet.exchangeEligiblePoints, 200);
  const started = await bridge.onAiUse({ featureId: 'analysis' });
  assert.equal(started.status, 'started');
  const spent = await bridge.fetchSnapshot();
  assert.equal(spent.wallet.availablePoints, 100);
  assert.equal(spent.wallet.exchangeEligiblePoints, 100);
  assert.equal(sandbox.mockAiInvocations, 1);
  const duplicate = await bridge.onAiUse({ featureId: 'analysis' });
  assert.equal(duplicate.status, 'already_processed');
  assert.equal(sandbox.mockAiInvocations, 1);
  const cohort = await sandbox.inspectSyntheticWalletCohort();
  assert.equal(cohort.observed.wallet_available_points, 3100);
  assert.equal(cohort.observed.wallet_eligible_points, 100);
  assert.equal(cohort.observed.ledger_confirmed_net_points, 3100);
  assert.equal(cohort.observed.wallet_balance_mismatch_users, 0);

  sandbox.setMockProviderOutcome(aiOperation, 'ai_reversed');
  const reversed = await sandbox.adminRequest({
    method: 'POST',
    body: { action: 'refund_recovered', operationId: aiOperation }
  });
  assert.equal(reversed.body.status, 'refunded');
  const restored = await bridge.fetchSnapshot();
  assert.equal(restored.wallet.availablePoints, 4200);
  assert.equal(restored.wallet.exchangeEligiblePoints, 200);
  assert.equal(
    new Set(restored.history.map((entry) => entry.operationId)).size,
    restored.history.length
  );
  const postRefundCohort = await sandbox.inspectSyntheticWalletCohort();
  assert.equal(postRefundCohort.observed.wallet_balance_mismatch_users, 0);
  assert.equal(postRefundCohort.observed.ledger_confirmed_net_points, 7200);
});

test('gift reservation and fulfillment only consume eligible formal Point, with reconciliation during hold', async () => {
  const sandbox = offline({ formalPoints: 30300, aiPrice: 120 });
  const requested = await sandbox.readerRequest(reader, {
    method: 'POST',
    body: {
      action: 'exchange_request',
      operationId: giftOperation,
      amountPoints: 30000
    }
  });
  assert.equal(requested.statusCode, 202);
  const reserved = await sandbox.inspectSyntheticWalletCohort();
  assert.equal(reserved.observed.wallet_balance_mismatch_users, 0);
  assert.equal(reserved.observed.wallet_reserved_points, 30000);
  assert.equal(reserved.observed.unsettled_ledger_rows, 1);
  assert.equal(reserved.observed.ledger_confirmed_net_points, 37300);
  const heldSnapshot = (await sandbox.readerRequest(reader, {
    method: 'GET'
  })).body;
  assert.equal(heldSnapshot.wallet.availablePoints, 4300);
  assert.equal(heldSnapshot.wallet.exchangeEligiblePoints, 300);
  assert.equal(heldSnapshot.wallet.heldPoints, 30000);

  sandbox.setMockProviderOutcome(giftOperation, 'fulfilled');
  const outcome = await sandbox.adminRequest({
    method: 'POST',
    body: { action: 'confirm_fulfilled', operationId: giftOperation }
  });
  assert.equal(outcome.body.status, 'committed');
  const cohort = await sandbox.inspectSyntheticWalletCohort();
  assert.equal(cohort.observed.wallet_reserved_points, 0);
  assert.equal(cohort.observed.wallet_available_points, 7300);
  assert.equal(cohort.observed.ledger_confirmed_net_points, 7300);
  assert.equal(cohort.observed.wallet_eligible_points, 300);
  assert.equal(cohort.observed.wallet_balance_mismatch_users, 0);
  const repeated = await sandbox.adminRequest({
    method: 'POST',
    body: { action: 'confirm_fulfilled', operationId: giftOperation }
  });
  assert.equal(repeated.body.status, 'already_processed');
  assert.equal(
    (await sandbox.inspectSyntheticWalletCohort()).observed.wallet_balance_mismatch_users,
    0
  );
});

test('unlinked badge Point is held for review; duplicate source event keys and tampered opening are rejected', async () => {
  const orphan = {
    ...rows[2],
    id: '00000000-0000-4000-8000-000000000597',
    event_key: 'badge:' + reader + ':reader_unknown_01',
    point_value: 60
  };
  const sandbox = offline({ sourceRows: [...rows, orphan] });
  const report = (await sandbox.adminRequest({
    method: 'GET',
    query: { view: 'badge_history' }
  })).body;
  assert.equal(report.observed.orphan_reader_badge_events, 1);
  assert.equal(report.observed.unclassified_badge_events, 1);
  assert.equal(report.mayIssuePoints, false);
  const altered = clone(rows);
  altered[2].event_key = altered[0].event_key;
  assert.equal(quoted(altered).status, 'legacy_ledger_identity_or_version_invalid');
  const tampered = quoted();
  tampered.walletSeeds = tampered.walletSeeds.map((seed) =>
    seed.userId === reader
      ? { ...seed, availablePoints: seed.availablePoints + 1 }
      : seed
  );
  assert.throws(
    () => createFormalOfflineIntegration({
      handoff: tampered,
      betaThresholdRows: thresholds,
      operatorId: operator,
      mockBudgets: {
        external_exchange: { scopeId: 'synthetic-gift', limitPoints: 100000 },
        ai_direct_use: { scopeId: 'synthetic-ai', limitPoints: 100000 }
      }
    }),
    TypeError
  );
});
