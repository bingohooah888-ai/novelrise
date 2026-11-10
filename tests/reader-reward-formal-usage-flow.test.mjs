import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormalRewardUsageService } from '../api/_lib/reader-reward/formal-usage-service.js';
import { createOfflineFormalUsageRepository } from '../api/_lib/reader-reward/formal-usage-offline-repository.js';
import { createFormalUsageHttpHandlers } from '../api/_lib/reader-reward/formal-usage-http.js';
await import('../assets/formal-scout-reward-client.js');

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
  aiResult = { status: 'succeeded', costPoints: 120 },
  exchangeBudget = 100000,
  allocation = 0
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
    catalog,
    policy: {
      giftProviderReady: providerReady,
      verifyExchange: async () => approval,
      verifyAi: async () => approval,
      allocateAiEligiblePoints: async ({
        amountPoints,
        availablePoints,
        exchangeEligiblePoints
      }) => {
        // Fixture-only, never a production allocation policy.
        const min = Math.max(
          0,
          amountPoints - (availablePoints - exchangeEligiblePoints)
        );
        return Math.max(min, allocation);
      }
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

function makeHttp(f) {
  const supabase = {
    auth: {
      async getUser(token) {
        const id =
          token === 'user-1'
            ? first
            : token === 'user-2'
              ? second
              : token === 'admin'
                ? adminId
                : null;
        return {
          data: { user: id ? { id, email: 'verified@example.test' } : null },
          error: id ? null : new Error('Unauthorized')
        };
      }
    }
  };
  return createFormalUsageHttpHandlers({
    supabase,
    service: f.service,
    env: { NOVELIGHT_ADMIN_USER_IDS: adminId }
  });
}
function httpReq(token, method = 'GET', body, origin = 'https://novelight.jp') {
  return {
    method,
    body,
    headers: {
      authorization: 'Bearer ' + token,
      origin,
      host: 'novelight.jp',
      'sec-fetch-site': 'same-origin',
      'x-forwarded-proto': 'https'
    }
  };
}
function res() {
  return {
    statusCode: 200,
    headers: {},
    result: null,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(result) {
      this.result = result;
      return this;
    }
  };
}
async function invoke(handler, req) {
  const reply = res();
  await handler(req, reply);
  return reply;
}

test('reader HTTP authenticates source identity and forbids client wallet/user forgery', async () => {
  const f = fixture();
  const api = makeHttp(f);
  const get = await invoke(api.reader, httpReq('user-1'));
  assert.equal(get.statusCode, 200);
  assert.equal(get.result.wallet.availablePoints, 50000);
  const forbidden = await invoke(
    api.reader,
    httpReq('user-2', 'POST', {
      action: 'exchange_request',
      operationId: op1,
      amountPoints: 30000,
      userId: first
    })
  );
  assert.equal(forbidden.statusCode, 400);
  assert.equal((await f.service.listPendingExchanges()).items.length, 0);
  const differentOrigin = await invoke(
    api.reader,
    httpReq(
      'user-1',
      'POST',
      {
        action: 'exchange_request',
        operationId: op1,
        amountPoints: 30000
      },
      'https://attacker.example'
    )
  );
  assert.equal(differentOrigin.statusCode, 403);
  const noAuth = await invoke(api.reader, httpReq('invalid'));
  assert.equal(noAuth.statusCode, 401);
  assert.equal((await f.service.listPendingExchanges()).items.length, 0);
});

test('admin queue requires existing admin allowlist and provider receipt is not browser supplied', async () => {
  const f = fixture();
  const api = makeHttp(f);
  const denied = await invoke(api.admin, httpReq('user-1'));
  assert.equal(denied.statusCode, 403);
  const queued = await invoke(
    api.reader,
    httpReq('user-1', 'POST', {
      action: 'exchange_request',
      operationId: op1,
      amountPoints: 30000
    })
  );
  assert.equal(queued.statusCode, 202);
  assert.equal(queued.result.status, 'request_received');
  const queue = await invoke(api.admin, httpReq('admin'));
  assert.equal(queue.statusCode, 200);
  assert.equal(queue.result.items.length, 1);
  const forged = await invoke(
    api.admin,
    httpReq('admin', 'POST', {
      operationId: op1,
      action: 'confirm_fulfilled',
      reviewerId: first
    })
  );
  assert.equal(forged.statusCode, 400);
  const done = await invoke(
    api.admin,
    httpReq('admin', 'POST', {
      operationId: op1,
      action: 'confirm_fulfilled'
    })
  );
  assert.equal(done.statusCode, 200);
  assert.equal(done.result.status, 'committed');
});

test('existing reader UI binding talks to authenticated unregistered HTTP handler', async () => {
  const f = fixture();
  const api = makeHttp(f);
  let counter = 0;
  const binding =
    globalThis.NovelightFormalRewardReaderBindings.createFormalReaderRewardBindings(
      {
        request: async ({ method, body }) => {
          const r = await invoke(api.reader, httpReq('user-1', method, body));
          return r.result;
        },
        nextOperationId: () => [op1, op2][counter++]
      }
    );
  const snapshot = await binding.fetchSnapshot();
  assert.equal(snapshot.serverVerified, true);
  assert.equal(snapshot.wallet.availablePoints, 50000);
  assert.equal(
    (await binding.onExchange({ amountPoints: 30000 })).status,
    'request_received'
  );
  assert.equal(
    (await binding.onAiUse({ featureId: 'analysis' })).status,
    'started'
  );
  assert.equal((await binding.fetchSnapshot()).wallet.availablePoints, 19880);
});

test('administrator UI binding calls the authenticated admin handler for queue and verified settlement', async () => {
  await import('../assets/formal-scout-reward-admin.js');
  const f = fixture();
  const api = makeHttp(f);
  await f.service.requestExchange({
    userId: first,
    operationId: op1,
    amountPoints: 30000
  });
  const admin = globalThis.NovelightFormalRewardAdmin.createFormalAdminBindings(
    {
      request: async ({ method, body }) => {
        const result = await invoke(api.admin, httpReq('admin', method, body));
        return result.result;
      }
    }
  );
  assert.equal((await admin.loadQueue()).items.length, 1);
  assert.equal(
    (
      await admin.onResolve({
        operationId: op1,
        action: 'confirm_fulfilled'
      })
    ).status,
    'committed'
  );
  assert.equal((await admin.loadQueue()).items.length, 0);
});

test('reader retry after a lost response keeps original operation UUID and prevents duplicate debit', async () => {
  const f = fixture();
  const api = makeHttp(f);
  let submitted = 0;
  const ids = [];
  const binding =
    globalThis.NovelightFormalRewardReaderBindings.createFormalReaderRewardBindings(
      {
        request: async ({ method, body }) => {
          const r = await invoke(api.reader, httpReq('user-1', method, body));
          if (method === 'POST') {
            ids.push(body.operationId);
            submitted++;
            if (submitted === 1)
              throw new Error('synthetic lost response after commit');
          }
          return r.result;
        },
        nextOperationId: () => op1
      }
    );
  await assert.rejects(
    binding.onExchange({ amountPoints: 30000 }),
    /synthetic lost response/
  );
  const retry = await binding.onExchange({ amountPoints: 30000 });
  assert.equal(retry.status, 'already_processed');
  assert.deepEqual(ids, [op1, op1]);
  const snap = await f.service.getReaderSnapshot(first);
  assert.equal(snap.wallet.availablePoints, 20000);
  assert.equal((await f.service.listPendingExchanges()).items.length, 1);
});
