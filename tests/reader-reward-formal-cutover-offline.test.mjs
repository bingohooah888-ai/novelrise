import test from 'node:test';
import assert from 'node:assert/strict';
import {
  quoteScoutOfflineBetaHandoff,
  reconcileScoutOfflineOpening
} from '../api/_lib/reader-reward/formal-cutover-offline.js';
import { createFormalOfflineIntegration } from '../api/_lib/reader-reward/formal-offline-integration.js';
await import('../assets/formal-scout-reward-client.js');
await import('../assets/formal-scout-reward-admin.js');

const reader = '00000000-0000-4000-8000-000000000401';
const second = '00000000-0000-4000-8000-000000000402';
const operator = '00000000-0000-4000-8000-000000000403';
const rewardId = '00000000-0000-4000-8000-000000000411';
const reverseId = '00000000-0000-4000-8000-000000000412';
const secondRewardId = '00000000-0000-4000-8000-000000000413';
const exchangeId = '00000000-0000-4000-8000-000000000421';
const aiId = '00000000-0000-4000-8000-000000000422';
const release = Date.parse('2026-12-01T00:00:00.000Z');
const betaThresholdRows = Array.from({ length: 30 }, (_, index) => {
  const level = index + 1;
  return {
    level,
    cumulative_xp:
      level === 1 ? 0 : (level - 1) * 50 + 10 * (level - 2) * (level - 1),
    rule_version: 'beta-2026-09-21'
  };
});
const betaSummary = {
  level: 30,
  total_xp: 9570,
  xp_into_level: 0,
  xp_for_next_level: 0,
  beta_level_max: true
};
const base = {
  ledgerUnitVersion: 'beta_one_point_per_yen',
  betaThresholdRows,
  formalReleaseAtMs: release,
  accounts: [
    {
      userId: reader,
      accountCreatedAtMs: Date.parse('2026-10-01T00:00:00.000Z'),
      verifiedBetaLedgerXp: 9570,
      betaSummary
    },
    {
      userId: second,
      accountCreatedAtMs: Date.parse('2026-09-25T00:00:00.000Z'),
      verifiedBetaLedgerXp: 9570,
      betaSummary
    }
  ],
  canonicalLedgerRows: [
    {
      id: rewardId,
      user_id: reader,
      event_key: 'beta-point:first',
      point_kind: 'level_up',
      point_value: 4000,
      status: 'confirmed',
      reversal_of: null
    },
    {
      id: reverseId,
      user_id: reader,
      event_key: 'beta-point:reversal',
      point_kind: 'adjustment',
      point_value: -500,
      status: 'confirmed',
      reversal_of: rewardId
    },
    {
      id: secondRewardId,
      user_id: second,
      event_key: 'beta-point:second',
      point_kind: 'badge_reward',
      point_value: 700,
      status: 'confirmed',
      reversal_of: null
    }
  ]
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const quote = (args = {}) =>
  quoteScoutOfflineBetaHandoff({
    ...clone(base),
    ...args
  });

test('offline beta 1->10 Point quote preserves event identity and excludes legacy from gift exchange', () => {
  const q = quote();
  assert.equal(q.status, 'offline_handoff_quote_only');
  assert.equal(q.convertedRows[0].eventKey, 'beta-point:first');
  assert.equal(q.convertedRows[0].convertedValue, 40000);
  assert.equal(q.convertedRows[1].convertedValue, -5000);
  assert.equal(q.summary.originalConfirmedNet, 4200);
  assert.equal(q.summary.convertedConfirmedNet, 42000);
  const user = q.walletSeeds.find((r) => r.userId === reader);
  assert.equal(user.availablePoints, 35000);
  assert.equal(user.exchangeEligiblePoints, 0);
  assert.equal(user.formalState.currentLevel, 30);
  assert.equal(user.formalState.levelProgressXp, 0);
  assert.equal(user.firstMaintenanceReviewDueAtMs, release + 30 * 86400000);
  assert.equal(q.mayIssuePoints, false);
  assert.equal(q.cutoverWasExecuted, false);
  assert.equal(
    reconcileScoutOfflineOpening({
      handoff: q,
      convertedLedgerRows: q.convertedRows
    }).status,
    'offline_opening_reconciled'
  );
});

test('offline initializer rejects uncertain units, unreviewed adjustments, mismatched XP and duplicate events', () => {
  assert.equal(
    quote({ ledgerUnitVersion: 'beta_ten_points_per_yen' }).status,
    'legacy_point_unit_not_verified'
  );
  const frozen = clone(base.canonicalLedgerRows);
  frozen[0].status = 'frozen';
  assert.equal(
    quote({ canonicalLedgerRows: frozen }).status,
    'nonconfirmed_legacy_point_requires_review'
  );
  const unlinked = clone(base.canonicalLedgerRows);
  unlinked[1].reversal_of = null;
  assert.equal(
    quote({ canonicalLedgerRows: unlinked }).status,
    'legacy_negative_adjustment_policy_pending'
  );
  const mixed = clone(base.canonicalLedgerRows);
  mixed[2].event_key = mixed[0].event_key;
  assert.equal(
    quote({ canonicalLedgerRows: mixed }).status,
    'legacy_ledger_identity_or_version_invalid'
  );
  const accounts = clone(base.accounts);
  accounts[0].verifiedBetaLedgerXp = 9500;
  assert.equal(quote({ accounts }).status, 'beta_xp_summary_ledger_mismatch');
  const overflow = clone(base.canonicalLedgerRows);
  overflow[0].point_value = 100001;
  assert.equal(
    quote({ canonicalLedgerRows: overflow }).status,
    'legacy_ledger_point_overflow'
  );
});

test('opening reconciliation refuses missing, altered and mixed-user converted rows', () => {
  const h = quote();
  assert.equal(
    reconcileScoutOfflineOpening({
      handoff: h,
      convertedLedgerRows: h.convertedRows.slice(1)
    }).status,
    'opening_ledger_count_or_identity_mismatch'
  );
  const altered = h.convertedRows.map((r) => ({ ...r }));
  altered[0].convertedValue++;
  assert.equal(
    reconcileScoutOfflineOpening({
      handoff: h,
      convertedLedgerRows: altered
    }).status,
    'opening_ledger_value_mismatch'
  );
  altered[0].convertedValue--;
  altered[0].userId = second;
  assert.equal(
    reconcileScoutOfflineOpening({
      handoff: h,
      convertedLedgerRows: altered
    }).status,
    'opening_ledger_value_mismatch'
  );
});

function demo() {
  return createFormalOfflineIntegration({
    handoff: quote(),
    betaThresholdRows,
    operatorId: operator,
    mockBudgets: {
      external_exchange: { scopeId: 'synthetic-exchange', limitPoints: 100000 },
      ai_direct_use: { scopeId: 'synthetic-ai', limitPoints: 10000 }
    },
    mockAiCatalog: [
      {
        id: 'analysis',
        name: '架空の作品分析',
        pricePoints: 120,
        approved: true
      }
    ],

    syntheticPostReleasePoints: [
      {
        eventId: 'offline-formal:batch-synthetic',
        userId: reader,
        amountPoints: 30500
      }
    ]
  });
}
test('synthetic integration connects reader/auth/API, gift confirmation/admin, AI Point spending and refunds', async () => {
  const sandbox = demo();
  assert.equal(sandbox.noRealPointOrProvider, true);
  assert.equal(sandbox.mode, 'offline_synthetic_only');
  const snapshot = await sandbox.readerRequest(reader, { method: 'GET' });
  assert.equal(snapshot.statusCode, 200);
  assert.equal(snapshot.body.wallet.availablePoints, 65500);
  assert.equal(snapshot.body.wallet.exchangeEligiblePoints, 30500);
  assert.equal(snapshot.body.account.level, 30);
  assert.equal(snapshot.body.account.requiredXp, 400);
  const other = await sandbox.readerRequest(second, { method: 'GET' });
  assert.equal(other.body.wallet.availablePoints, 7000);
  assert.equal(other.body.wallet.exchangeEligiblePoints, 0);
  const exchange = await sandbox.readerRequest(reader, {
    method: 'POST',
    body: {
      action: 'exchange_request',
      operationId: exchangeId,
      amountPoints: 30000
    }
  });
  assert.equal(exchange.statusCode, 202);
  const unresolved = await sandbox.adminRequest({
    method: 'POST',
    body: { action: 'confirm_fulfilled', operationId: exchangeId }
  });
  assert.equal(unresolved.statusCode, 409);
  assert.equal(unresolved.body.error, 'fulfillment_evidence_missing');
  sandbox.setMockProviderOutcome(exchangeId, 'fulfilled');
  const committed = await sandbox.adminRequest({
    method: 'POST',
    body: { action: 'confirm_fulfilled', operationId: exchangeId }
  });
  assert.equal(committed.body.status, 'committed');
  const ai = await sandbox.readerRequest(reader, {
    method: 'POST',
    body: { action: 'ai_use', operationId: aiId, featureId: 'analysis' }
  });
  assert.equal(ai.body.status, 'started');
  assert.equal(sandbox.mockAiInvocations, 1);
  const beforeRefund = await sandbox.readerRequest(reader, { method: 'GET' });
  assert.equal(beforeRefund.body.wallet.availablePoints, 35380);
  const refused = await sandbox.adminRequest({
    method: 'POST',
    body: { action: 'refund_recovered', operationId: exchangeId }
  });
  assert.equal(refused.statusCode, 409);
  sandbox.setMockProviderOutcome(exchangeId, 'recovered');
  const reversed = await sandbox.adminRequest({
    method: 'POST',
    body: { action: 'refund_recovered', operationId: exchangeId }
  });
  assert.equal(reversed.body.status, 'refunded');
  const after = await sandbox.readerRequest(reader, { method: 'GET' });
  assert.equal(after.body.wallet.availablePoints, 65380);
  assert.equal(after.body.wallet.exchangeEligiblePoints, 30500);
  assert.equal(after.body.history[0].kind, 'refund');
  assert.equal(sandbox.mockGiftVerifications, 2);
});

test('existing reader binding works with offline handler transport, without real provider or AI', async () => {
  const sandbox = demo();
  const bridge =
    globalThis.NovelightFormalRewardReaderBindings.createFormalReaderRewardBindings(
      {
        request: async (input) => {
          const res = await sandbox.readerRequest(reader, input);
          return res.body;
        },
        nextOperationId: (() => {
          let c = 0;
          return () => [exchangeId, aiId][c++];
        })()
      }
    );
  const before = await bridge.fetchSnapshot();
  assert.equal(before.account.level, 30);
  assert.equal(
    (await bridge.onExchange({ amountPoints: 30000 })).status,
    'request_received'
  );
  assert.equal(
    (await bridge.onAiUse({ featureId: 'analysis' })).status,
    'started'
  );
  assert.equal(sandbox.mockAiInvocations, 1);
  const admin = globalThis.NovelightFormalRewardAdmin.createFormalAdminBindings(
    {
      request: async (input) => (await sandbox.adminRequest(input)).body
    }
  );
  assert.equal((await admin.loadQueue()).items.length, 1);
  assert.equal((await admin.loadRefunds()).items.length, 1);
});

test('offline AI allocation follows approved beta-first rule without optional strategy', async () => {
  const args = {
    handoff: quote(),
    betaThresholdRows,
    operatorId: operator,
    mockBudgets: {
      external_exchange: { scopeId: 'synthetic-gift', limitPoints: 100000 },
      ai_direct_use: { scopeId: 'synthetic-ai', limitPoints: 100000 }
    },
    mockAiCatalog: [
      { id: 'analysis', name: '架空作品分析', pricePoints: 120, approved: true }
    ]
  };
  const sandbox = createFormalOfflineIntegration(args);
  const ai = await sandbox.readerRequest(reader, {
    method: 'POST',
    body: { action: 'ai_use', operationId: aiId, featureId: 'analysis' }
  });
  assert.equal(ai.statusCode, 200);
  assert.equal(ai.body.status, 'started');
  assert.equal(sandbox.mockAiInvocations, 1);
  const readerAfter = await sandbox.readerRequest(reader, { method: 'GET' });
  assert.equal(readerAfter.body.wallet.exchangeEligiblePoints, 0);
});

test('old beta-only Points stay exchange-ineligible but are spent first for AI', async () => {
  const sandbox = demo();
  const exchange = await sandbox.readerRequest(second, {
    method: 'POST',
    body: {
      action: 'exchange_request',
      operationId: exchangeId,
      amountPoints: 30000
    }
  });
  assert.equal(exchange.statusCode, 409);
  assert.equal(exchange.body.error, 'insufficient_exchange_eligible_points');
  const ai = await sandbox.readerRequest(second, {
    method: 'POST',
    body: { action: 'ai_use', operationId: aiId, featureId: 'analysis' }
  });
  assert.equal(ai.body.status, 'started');
  const next = await sandbox.readerRequest(second, { method: 'GET' });
  assert.equal(next.body.wallet.availablePoints, 6880);
  assert.equal(next.body.wallet.exchangeEligiblePoints, 0);
});

test('mock rejects Point grants for nonexistent reader fixtures and duplicate event keys', async () => {
  const q = quote();
  const basic = {
    handoff: q,
    betaThresholdRows,
    operatorId: operator,
    mockBudgets: {
      external_exchange: { scopeId: 'synthetic-gift', limitPoints: 100000 },
      ai_direct_use: { scopeId: 'synthetic-ai', limitPoints: 100000 }
    }
  };
  assert.throws(
    () =>
      createFormalOfflineIntegration({
        ...basic,
        syntheticPostReleasePoints: [
          {
            eventId: 'offline-formal:fake',
            userId: operator,
            amountPoints: 100
          }
        ]
      }),
    /Invalid synthetic reward event/
  );
  assert.throws(
    () =>
      createFormalOfflineIntegration({
        ...basic,
        syntheticPostReleasePoints: [
          {
            eventId: 'offline-formal:duplicate',
            userId: reader,
            amountPoints: 100
          },
          {
            eventId: 'offline-formal:duplicate',
            userId: reader,
            amountPoints: 100
          }
        ]
      }),
    /Invalid synthetic reward event/
  );
});
