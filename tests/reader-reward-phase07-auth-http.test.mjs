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

function makeHttp(f, getAdminRewardOverview) {
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
    env: { NOVELIGHT_ADMIN_USER_IDS: adminId },
    getAdminRewardOverview
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

test('only authorized administrator can read formal reward accounting overview', async () => {
  const f = fixture();
  let reads = 0;
  const api = makeHttp(f, async () => {
    reads++;
    return {
      status: 'reward_overview_ready',
      pointsPerYen: 10,
      issuedMonth: 50,
      issuedTotal: 200,
      readMonth: 30,
      commentMonth: 20,
      giftSpentNet: 0,
      aiSpentNet: 0,
      eligibleAvailable: 150,
      eligibleReserved: 0,
      pendingExchangePoints: 0,
      pendingExchangeCount: 0,
      recent: []
    };
  });
  const readerReq = httpReq('user-1');
  readerReq.query = { view: 'reward_overview' };
  assert.equal((await invoke(api.admin, readerReq)).statusCode, 403);
  const noAuthReq = httpReq('invalid');
  noAuthReq.query = { view: 'reward_overview' };
  assert.notEqual((await invoke(api.admin, noAuthReq)).statusCode, 200);
  assert.equal(reads, 0);
  const adminReq = httpReq('admin');
  adminReq.query = { view: 'reward_overview' };
  const response = await invoke(api.admin, adminReq);
  assert.equal(response.statusCode, 200);
  assert.equal(response.result.issuedMonth, 50);
  assert.equal(response.result.status, 'reward_overview_ready');
  assert.equal(reads, 1);
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

test('admin earning evidence returns only a safe verdict', async () => {
  const f = fixture({ enabled: false });
  const inspections = [];
  const supabase = {
    auth: {
      async getUser(token) {
        const id =
          token === 'admin' ? adminId : token === 'user-1' ? first : null;
        return {
          data: { user: id ? { id } : null },
          error: id ? null : new Error('Unauthorized')
        };
      }
    }
  };
  const api = createFormalUsageHttpHandlers({
    supabase,
    service: f.service,
    env: { NOVELIGHT_ADMIN_USER_IDS: adminId },
    inspectEarningSource: async (eventType, eventId) => {
      inspections.push({ eventType, eventId });
      return {
        status: 'canonical_source_verified',
        eventType,
        eventId,
        verifiedComment: { body: 'PRIVATE_COMMENT' },
        readerId: first
      };
    }
  });
  const request = (token, eventType, eventId) => ({
    ...httpReq(token),
    query: { view: 'earning_source', eventType, eventId }
  });
  const denied = await invoke(
    api.admin,
    request('user-1', 'valid_read_qualified', op1)
  );
  assert.equal(denied.statusCode, 403);
  assert.equal(inspections.length, 0);
  const report = await invoke(
    api.admin,
    request('admin', 'valid_read_qualified', op1)
  );
  assert.equal(report.statusCode, 200);
  assert.deepEqual(report.result, {
    ok: true,
    eventType: 'valid_read_qualified',
    status: 'canonical_source_verified',
    mayIssuePoints: false
  });
  assert.deepEqual(inspections, [
    { eventType: 'valid_read_qualified', eventId: op1 }
  ]);
  assert.doesNotMatch(
    JSON.stringify(report.result),
    /PRIVATE_COMMENT|readerId/
  );
  const malformed = await invoke(
    api.admin,
    request('admin', 'unsupported_type', op1)
  );
  assert.equal(malformed.statusCode, 400);
  assert.equal(inspections.length, 1);
});
