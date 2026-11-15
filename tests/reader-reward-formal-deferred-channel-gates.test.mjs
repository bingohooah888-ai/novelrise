import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OWNER_DEFERRED_CHANNELS,
  holdDeferredFormalChannels
} from '../api/_lib/reader-reward/formal-deferred-channel-gates.js';
import { createUnregisteredFormalApplication } from '../api/_lib/reader-reward/formal-application-host.js';

const USER = '11111111-1111-4111-8111-111111111111';
const OPERATION = '22222222-2222-4222-8222-222222222222';
const FEATURE = 'character_reminder';

test('OWNER-held gift and AI channels cannot be enabled by provided policies or prices', () => {
  const source = {
    catalog: [
      {
        id: FEATURE,
        name: 'この人物誰だっけ？',
        pricePoints: 300,
        approved: true
      }
    ],
    policy: {
      giftProviderReady: true,
      verifyExchange: () => ({ eligibility: true }),
      verifyAi: () => ({ aiPrice: true }),
      verifyGiftRefund: () => true
    }
  };
  const blocked = holdDeferredFormalChannels(source);
  assert.deepEqual(OWNER_DEFERRED_CHANNELS, {
    externalGiftExchange: false,
    aiDirectPointUse: false
  });
  assert.equal(blocked.policy.giftProviderReady, false);
  assert.equal(blocked.policy.verifyExchange, undefined);
  assert.equal(blocked.policy.verifyAi, undefined);
  assert.equal(typeof blocked.policy.verifyGiftRefund, 'function');
  assert.equal(blocked.catalog[0].approved, false);
  assert.equal(blocked.catalog[0].pricePoints, null);
  assert.equal(blocked.catalog[0].name, 'この人物誰だっけ？');
  assert.equal(blocked.aiExecutor, undefined);
  assert.equal(source.catalog[0].approved, true);
  assert.equal(source.catalog[0].pricePoints, 300);
});

test('formal app denies gift and priced AI requests even if other release gates are true', async () => {
  let dbCalls = 0;
  let providerCalls = 0;
  const pool = {
    async query() {
      dbCalls++;
      throw new Error('UNEXPECTED_DATABASE_QUERY');
    },
    async connect() {
      dbCalls++;
      throw new Error('UNAPPROVED_DATABASE_TRANSACTION');
    }
  };
  const app = createUnregisteredFormalApplication({
    pool,
    supabase: {
      auth: {
        async getUser() {
          return { data: { user: { id: USER } }, error: null };
        }
      }
    },
    releaseTimestampIso: '2026-11-15T00:00:00.000Z',
    releaseConfiguration: {
      formalRewardsEnabled: true,
      productionCutoverApproved: true,
      formalEarningsEnabled: false
    },
    trustedServerAuthorization: {
      verifiedByTrustedServer: true,
      serviceRoleVerified: true
    },
    catalog: [
      {
        id: FEATURE,
        name: 'この人物誰だっけ？',
        approved: true,
        pricePoints: 300
      }
    ],
    policy: {
      giftProviderReady: true,
      verifyExchange: async () => {
        providerCalls++;
        return {
          eligibility: true,
          risk: true,
          channel: true
        };
      },
      verifyAi: async () => {
        providerCalls++;
        return {
          eligibility: true,
          risk: true,
          channel: true,
          aiPrice: true
        };
      }
    },
    aiExecutor: async () => {
      providerCalls++;
      return { status: 'succeeded', costPoints: 300 };
    },
    now: () => Date.parse('2026-11-15T00:00:00.000Z'),
    env: {}
  });
  async function invoke(body) {
    const res = {
      code: 200,
      body: null,
      setHeader() {},
      status(code) {
        this.code = code;
        return this;
      },
      json(value) {
        this.body = value;
        return this;
      }
    };
    await app.readerHttp(
      {
        method: 'POST',
        body,
        query: {},
        headers: {
          authorization: 'Bearer test-session',
          origin: 'https://novelight.jp',
          host: 'novelight.jp',
          'x-forwarded-proto': 'https',
          'sec-fetch-site': 'same-origin'
        }
      },
      res
    );
    return res;
  }
  const exchange = await invoke({
    action: 'exchange_request',
    operationId: OPERATION,
    amountPoints: 30000
  });
  assert.equal(exchange.body.error, 'gift_provider_unavailable');
  const ai = await invoke({
    action: 'ai_use',
    operationId: OPERATION,
    featureId: FEATURE
  });
  assert.equal(ai.body.error, 'ai_price_or_feature_unapproved');
  assert.equal(dbCalls, 0);
  assert.equal(providerCalls, 0);
  assert.equal(typeof app.getReaderSnapshot, 'function');
});
