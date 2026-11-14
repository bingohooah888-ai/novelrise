import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormalRewardUsageService } from '../api/_lib/reader-reward/formal-usage-service.js';
import { createOfflineFormalUsageRepository } from '../api/_lib/reader-reward/formal-usage-offline-repository.js';

const first = '00000000-0000-4000-8000-000000000301';
const second = '00000000-0000-4000-8000-000000000302';
const adminId = '00000000-0000-4000-8000-000000000303';
const op1 = '00000000-0000-4000-8000-000000000311';
const op2 = '00000000-0000-4000-8000-000000000312';
const op3 = '00000000-0000-4000-8000-000000000313';
const approval = Object.freeze({
  budget: true,
  eligibility: true,
  risk: true,
  channel: true,
  aiPrice: true
});
const catalog = [
  { id: 'analysis', name: '作品分析', pricePoints: 120, approved: true }
];
function fixture({
  enabled = true,
  providerReady = true,
  verifyReceipt = true,
  verifyNonFulfillment = true,
  verifyGiftRefund = true,
  verifyAiRefund = true,
  aiResult = { status: 'succeeded', costPoints: 120 },
  exchangeBudget = 100000,
  budgetApproved = true,
  aiPricePoints = 120
} = {}) {
  const repository = createOfflineFormalUsageRepository({
    readers: [
      {
        userId: first,
        availablePoints: 50000,
        exchangeEligiblePoints: 32000,
        account: {
          level: 75,
          progressXp: 33,
          requiredXp: 400,
          earnedXpInPeriod: 155
        }
      },
      { userId: second, availablePoints: 32000, exchangeEligiblePoints: 32000 }
    ],
    budgets: {
      external_exchange: {
        scopeId: 'offline-gift',
        limitPoints: exchangeBudget
      },
      ai_direct_use: { scopeId: 'offline-ai', limitPoints: 100000 }
    }
  });
  let aiCalls = 0;
  let verificationCalls = 0;
  const service = createFormalRewardUsageService({
    repository,
    releaseConfiguration: {
      formalRewardsEnabled: enabled,
      productionCutoverApproved: enabled
    },
    trustedServerAuthorization: {
      serviceRoleVerified: true,
      verifiedByTrustedServer: true
    },
    catalog: catalog.map((feature) => ({
      ...feature,
      pricePoints: aiPricePoints
    })),
    policy: {
      giftProviderReady: providerReady,
      verifyExchange: async () => ({ ...approval, budget: budgetApproved }),
      verifyAi: async () => ({ ...approval, budget: budgetApproved })
    },
    aiExecutor: async () => {
      aiCalls++;
      if (aiResult instanceof Error) throw aiResult;
      return aiResult;
    },
    verifyGiftReceipt: async () => {
      verificationCalls++;
      return verifyReceipt;
    },
    verifyGiftNonFulfillment: async () => {
      verificationCalls++;
      return verifyNonFulfillment;
    },
    verifyGiftRefund: async () => {
      verificationCalls++;
      return verifyGiftRefund;
    },
    verifyAiRefund: async () => {
      verificationCalls++;
      return verifyAiRefund;
    }
  });
  return {
    service,
    repository,
    get aiCalls() {
      return aiCalls;
    },
    get verificationCalls() {
      return verificationCalls;
    }
  };
}

test('no monthly business budget permits reservations while enforcing duplicate claims', async () => {
  const f = fixture({ exchangeBudget: null, budgetApproved: false });
  const request = (userId, operationId) =>
    f.service.requestExchange({ userId, operationId, amountPoints: 30000 });
  assert.equal((await request(first, op1)).status, 'request_received');
  assert.equal((await request(second, op2)).status, 'request_received');
  assert.equal((await request(first, op1)).status, 'already_processed');
  assert.equal((await f.service.listPendingExchanges()).items.length, 2);
  assert.equal(
    (await f.service.getReaderSnapshot(first)).wallet.availablePoints,
    20000
  );
  assert.equal(
    (await f.service.getReaderSnapshot(second)).wallet.availablePoints,
    2000
  );
});
test('reader exchange: 30000pt reserve reduces both balances and is idempotent', async () => {
  const f = fixture();
  assert.equal(
    (
      await f.service.requestExchange({
        userId: first,
        operationId: op1,
        amountPoints: 29999
      })
    ).status,
    'below_exchange_minimum'
  );
  assert.equal(
    (
      await f.service.requestExchange({
        userId: first,
        operationId: op1,
        amountPoints: 30000
      })
    ).status,
    'request_received'
  );
  const state = await f.service.getReaderSnapshot(first);
  assert.deepEqual(state.wallet, {
    availablePoints: 20000,
    exchangeEligiblePoints: 2000,
    heldPoints: 30000
  });
  assert.equal(state.history[0].points, -30000);
  assert.equal(state.history[0].status, 'pending');
  const again = await f.service.requestExchange({
    userId: first,
    operationId: op1,
    amountPoints: 30000
  });
  assert.equal(again.status, 'already_processed');
  assert.deepEqual(
    (await f.service.getReaderSnapshot(first)).wallet,
    state.wallet
  );
  assert.equal((await f.service.listPendingExchanges()).items.length, 1);
});

test('owner-only confirmed provider receipt commits a reserved gift without any real provider', async () => {
  const f = fixture();
  await f.service.requestExchange({
    userId: first,
    operationId: op1,
    amountPoints: 30000
  });
  assert.equal(
    (
      await f.service.resolveExchange({
        operationId: op1,
        action: 'confirm_fulfilled',
        reviewerId: adminId
      })
    ).status,
    'committed'
  );
  assert.equal((await f.service.listPendingExchanges()).items.length, 0);
  const s = await f.service.getReaderSnapshot(first);
  assert.equal(s.wallet.heldPoints, 0);
  assert.equal(s.wallet.availablePoints, 20000);
  assert.equal(s.wallet.exchangeEligiblePoints, 2000);
  assert.equal(s.history[0].status, 'confirmed');
  assert.equal(
    (
      await f.service.resolveExchange({
        operationId: op1,
        action: 'confirm_fulfilled',
        reviewerId: adminId
      })
    ).status,
    'already_processed'
  );
});

test('failed or unverified gift proof holds a request; confirmed non-fulfillment releases it', async () => {
  const f = fixture({ verifyReceipt: false });
  await f.service.requestExchange({
    userId: first,
    operationId: op1,
    amountPoints: 30000
  });
  assert.equal(
    (
      await f.service.resolveExchange({
        operationId: op1,
        action: 'confirm_fulfilled',
        reviewerId: adminId
      })
    ).status,
    'fulfillment_evidence_missing'
  );
  assert.equal((await f.service.listPendingExchanges()).items.length, 1);
  assert.equal(
    (
      await f.service.resolveExchange({
        operationId: op1,
        action: 'release_unfulfilled',
        reviewerId: adminId
      })
    ).status,
    'released'
  );
  const restored = await f.service.getReaderSnapshot(first);
  assert.equal(restored.wallet.availablePoints, 50000);
  assert.equal(restored.wallet.exchangeEligiblePoints, 32000);
  assert.equal(restored.history[0].status, 'cancelled');
});

test('AI is charged directly in approved Point units below gift minimum; no separate AI Credit', async () => {
  const f = fixture();
  const s = await f.service.requestAiUse({
    userId: first,
    operationId: op2,
    featureId: 'analysis'
  });
  assert.equal(s.status, 'started');
  assert.equal(f.aiCalls, 1);
  const current = await f.service.getReaderSnapshot(first);
  assert.equal(current.wallet.availablePoints, 49880);
  assert.equal(current.wallet.exchangeEligiblePoints, 32000);
  assert.equal(current.history[0].points, -120);
  assert.equal(current.history[0].status, 'confirmed');
  assert.equal(
    (
      await f.service.requestAiUse({
        userId: first,
        operationId: op2,
        featureId: 'analysis'
      })
    ).status,
    'already_processed'
  );
  assert.equal(f.aiCalls, 1);
  assert.equal('aiCredits' in current.wallet, false);
});

test('AI spends beta Points first and only the shortfall uses exchange-eligible formal Points', async () => {
  const f = fixture({
    aiPricePoints: 19000,
    aiResult: { status: 'succeeded', costPoints: 19000 }
  });
  const firstUse = await f.service.requestAiUse({
    userId: first,
    operationId: op2,
    featureId: 'analysis'
  });
  assert.equal(firstUse.status, 'started');
  const after = await f.service.getReaderSnapshot(first);
  // 18,000 beta Points are spent; the 1,000 Point shortfall comes from formal.
  assert.equal(after.wallet.availablePoints, 31000);
  assert.equal(after.wallet.exchangeEligiblePoints, 31000);
  assert.equal(after.history[0].points, -19000);
  const duplicate = await f.service.requestAiUse({
    userId: first,
    operationId: op2,
    featureId: 'analysis'
  });
  assert.equal(duplicate.status, 'already_processed');
  assert.equal(f.aiCalls, 1);
  // Formal Point availability is still enough for a 30,000 Point exchange.
  const exchange = await f.service.requestExchange({
    userId: first,
    operationId: op1,
    amountPoints: 30000
  });
  assert.equal(exchange.status, 'request_received');
  const remaining = await f.service.getReaderSnapshot(first);
  assert.equal(remaining.wallet.exchangeEligiblePoints, 1000);
});
test('AI explicit no-execution refunds reservation; unknown outcome stays held for reconciliation', async () => {
  const failed = fixture({ aiResult: { status: 'not_executed' } });
  assert.equal(
    (
      await failed.service.requestAiUse({
        userId: first,
        operationId: op2,
        featureId: 'analysis'
      })
    ).status,
    'released'
  );
  assert.equal(
    (await failed.service.getReaderSnapshot(first)).wallet.availablePoints,
    50000
  );
  const unknown = fixture({ aiResult: new Error('synthetic interruption') });
  assert.equal(
    (
      await unknown.service.requestAiUse({
        userId: first,
        operationId: op2,
        featureId: 'analysis'
      })
    ).status,
    'ai_execution_uncertain_held'
  );
  assert.equal(
    (await unknown.service.getReaderSnapshot(first)).wallet.heldPoints,
    120
  );
  assert.equal(
    (
      await unknown.service.requestAiUse({
        userId: first,
        operationId: op2,
        featureId: 'analysis'
      })
    ).status,
    'already_processed'
  );
  assert.equal(unknown.aiCalls, 1);
});

test('shared wallet blocks an exchange after AI allocation consumes too many formal Points', async () => {
  const f = fixture();
  await f.service.requestExchange({
    userId: first,
    operationId: op1,
    amountPoints: 30000
  });
  const used = await f.service.requestAiUse({
    userId: first,
    operationId: op2,
    featureId: 'analysis'
  });
  assert.equal(used.status, 'started');
  assert.equal(
    (
      await f.service.requestExchange({
        userId: first,
        operationId: op3,
        amountPoints: 30000
      })
    ).status,
    'insufficient_exchange_eligible_points'
  );
});

test('two readers share one globally serialized budget without oversubscription', async () => {
  const f = fixture({ exchangeBudget: 30000 });
  const outcomes = await Promise.all([
    f.service.requestExchange({
      userId: first,
      operationId: op1,
      amountPoints: 30000
    }),
    f.service.requestExchange({
      userId: second,
      operationId: op2,
      amountPoints: 30000
    })
  ]);
  assert.deepEqual(outcomes.map((o) => o.status).sort(), [
    'budget_exceeded',
    'request_received'
  ]);
  assert.equal((await f.service.listPendingExchanges()).items.length, 1);
});

test('formal release disabled, no gift provider and no AI price do not reserve or invoke a provider', async () => {
  const off = fixture({ enabled: false });
  assert.equal(
    (
      await off.service.requestExchange({
        userId: first,
        operationId: op1,
        amountPoints: 30000
      })
    ).status,
    'formal_use_disabled'
  );
  assert.equal(
    (
      await off.service.requestAiUse({
        userId: first,
        operationId: op2,
        featureId: 'analysis'
      })
    ).status,
    'formal_use_disabled'
  );
  const noProvider = fixture({ providerReady: false });
  assert.equal(
    (
      await noProvider.service.requestExchange({
        userId: first,
        operationId: op1,
        amountPoints: 30000
      })
    ).status,
    'gift_provider_unavailable'
  );
  assert.equal(
    (
      await noProvider.service.requestAiUse({
        userId: first,
        operationId: op2,
        featureId: 'unknown'
      })
    ).status,
    'ai_price_or_feature_unapproved'
  );
  assert.equal(noProvider.aiCalls, 0);
});

test('confirmed gift refund restores original Point buckets once, without replenishing settlement budget', async () => {
  const f = fixture();
  await f.service.requestExchange({
    userId: first,
    operationId: op1,
    amountPoints: 30000
  });
  await f.service.resolveExchange({
    operationId: op1,
    action: 'confirm_fulfilled',
    reviewerId: adminId
  });
  assert.equal((await f.service.listRefundCandidates()).items.length, 1);
  const initial = await f.service.getReaderSnapshot(first);
  assert.equal(initial.wallet.availablePoints, 20000);
  const result = await f.service.refundCommitted({
    operationId: op1,
    reviewerId: adminId
  });
  assert.equal(result.status, 'refunded');
  const restored = await f.service.getReaderSnapshot(first);
  assert.equal(restored.wallet.availablePoints, 50000);
  assert.equal(restored.wallet.exchangeEligiblePoints, 32000);
  assert.equal(restored.history[0].points, 30000);
  assert.equal(restored.history[0].kind, 'refund');
  assert.equal((await f.service.listRefundCandidates()).items.length, 0);
  assert.equal(
    (
      await f.service.refundCommitted({
        operationId: op1,
        reviewerId: adminId
      })
    ).status,
    'already_processed'
  );
  // No new refund on a repeated admin request and no silent budget recycle.
  assert.equal(
    (
      await f.service.requestExchange({
        userId: first,
        operationId: op2,
        amountPoints: 30000
      })
    ).status,
    'request_received'
  );
});

test('gift refund refuses unverified money recovery, while AI refund requires independent usage reversal', async () => {
  const blocked = fixture({ verifyGiftRefund: false });
  await blocked.service.requestExchange({
    userId: first,
    operationId: op1,
    amountPoints: 30000
  });
  await blocked.service.resolveExchange({
    operationId: op1,
    action: 'confirm_fulfilled',
    reviewerId: adminId
  });
  assert.equal(
    (
      await blocked.service.refundCommitted({
        operationId: op1,
        reviewerId: adminId
      })
    ).status,
    'refund_evidence_missing'
  );
  assert.equal(
    (await blocked.service.getReaderSnapshot(first)).wallet.availablePoints,
    20000
  );
  const ai = fixture({ verifyAiRefund: true });
  await ai.service.requestAiUse({
    userId: first,
    operationId: op2,
    featureId: 'analysis'
  });
  assert.equal(
    (
      await ai.service.refundCommitted({
        operationId: op2,
        reviewerId: adminId
      })
    ).status,
    'refunded'
  );
  assert.equal(
    (await ai.service.getReaderSnapshot(first)).wallet.availablePoints,
    50000
  );
  const aiBlocked = fixture({ verifyAiRefund: false });
  await aiBlocked.service.requestAiUse({
    userId: first,
    operationId: op2,
    featureId: 'analysis'
  });
  assert.equal(
    (
      await aiBlocked.service.refundCommitted({
        operationId: op2,
        reviewerId: adminId
      })
    ).status,
    'refund_evidence_missing'
  );
});

// The offline browser binding preserves the operation claim after a lost response.
await import('../assets/formal-scout-reward-client.js');

test('reader retry after an uncertain response retains the same operation UUID', async () => {
  const f = fixture();
  let submissions = 0;
  const ids = [];
  const binding =
    globalThis.NovelightFormalRewardReaderBindings.createFormalReaderRewardBindings(
      {
        request: async ({ method, body: payload }) => {
          if (method !== 'POST') throw new Error('unexpected request');
          ids.push(payload.operationId);
          const result = await f.service.requestExchange({
            userId: first,
            operationId: payload.operationId,
            amountPoints: payload.amountPoints
          });
          submissions++;
          if (submissions === 1) throw new Error('synthetic response loss');
          return result;
        },
        nextOperationId: () => op3
      }
    );
  await assert.rejects(
    binding.onExchange({ amountPoints: 30000 }),
    /synthetic response loss/
  );
  const result = await binding.onExchange({ amountPoints: 30000 });
  assert.equal(result.status, 'already_processed');
  assert.deepEqual(ids, [op3, op3]);
  assert.equal(
    (await f.service.getReaderSnapshot(first)).wallet.availablePoints,
    20000
  );
});
