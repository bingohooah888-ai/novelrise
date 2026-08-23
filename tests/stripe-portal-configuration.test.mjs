import assert from 'node:assert/strict';
import test from 'node:test';

import { createBillingPortalHandler } from '../api/_lib/billing-portal.js';
import { createCheckoutHandler } from '../api/_lib/checkout.js';

function responseRecorder() {
  const state = { statusCode: null, body: null };
  return {
    state,
    res: {
      status(code) {
        state.statusCode = code;
        return this;
      },
      json(body) {
        state.body = body;
        return this;
      }
    }
  };
}

function profileSupabase(profile) {
  return {
    auth: {
      async getUser() {
        return {
          data: {
            user: {
              id: 'user-123',
              email: 'author@example.com'
            }
          },
          error: null
        };
      }
    },
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async limit() {
          return { data: [profile], error: null };
        }
      };
    }
  };
}

test('billing portal API uses the managed portal configuration when configured', async () => {
  const calls = [];
  const handler = createBillingPortalHandler({
    supabase: profileSupabase({ stripe_customer_id: 'cus_123' }),
    stripe: {
      billingPortal: {
        sessions: {
          async create(payload) {
            calls.push(payload);
            return { url: 'https://billing.stripe.test/session' };
          }
        }
      }
    },
    env: {
      NOVELIGHT_APP_URL: 'https://novelight.test',
      STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_novelight'
    }
  });
  const { res, state } = responseRecorder();

  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' }
    },
    res
  );

  assert.equal(state.statusCode, 200);
  assert.deepEqual(calls, [
    {
      customer: 'cus_123',
      return_url: 'https://novelight.test/mypage.html',
      configuration: 'bpc_novelight'
    }
  ]);
});

test('paid checkout management uses the managed portal configuration', async () => {
  const calls = [];
  const handler = createCheckoutHandler({
    supabase: profileSupabase({
      plan: 'standard',
      stripe_customer_id: 'cus_123'
    }),
    stripe: {
      subscriptions: {
        async list() {
          return { data: [] };
        }
      },
      checkout: {
        sessions: {
          async create() {
            throw new Error('checkout should not be created');
          }
        }
      },
      billingPortal: {
        sessions: {
          async create(payload) {
            calls.push(payload);
            return { url: 'https://billing.stripe.test/session' };
          }
        }
      }
    },
    env: {
      NOVELIGHT_APP_URL: 'https://novelight.test',
      STRIPE_STANDARD_PRICE_ID: 'price_standard',
      STRIPE_PREMIUM_PRICE_ID: 'price_premium',
      STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_novelight'
    }
  });
  const { res, state } = responseRecorder();

  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: { plan: 'premium' }
    },
    res
  );

  assert.equal(state.statusCode, 200);
  assert.equal(state.body.mode, 'portal');
  assert.deepEqual(calls, [
    {
      customer: 'cus_123',
      return_url: 'https://novelight.test/pricing.html',
      configuration: 'bpc_novelight'
    }
  ]);
});
