import assert from 'node:assert/strict';
import test from 'node:test';

import { createCheckoutHandler } from '../api/_lib/checkout.js';

function createResponse() {
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

function createStaleCustomerDependencies() {
  const user = { id: 'user-123', email: 'author@example.com' };
  const profile = { plan: 'free', stripe_customer_id: 'cus_stale' };
  const calls = {
    checkoutSessions: [],
    profileUpdates: [],
    subscriptionLists: []
  };
  let attempt = null;

  const supabase = {
    auth: {
      async getUser() {
        return { data: { user }, error: null };
      }
    },
    async rpc(name, args) {
      if (name === 'novelight_reserve_checkout_attempt') {
        attempt ??= {
          attempt_id: args.p_candidate_attempt_id,
          plan: args.p_plan,
          stripe_session_id: null,
          expires_at: '2099-01-01T00:00:00.000Z'
        };
        return { data: [attempt], error: null };
      }

      if (name === 'novelight_attach_checkout_session') {
        attempt.stripe_session_id = args.p_stripe_session_id;
        return { data: true, error: null };
      }

      throw new Error(`Unexpected RPC ${name}`);
    },
    from(table) {
      assert.equal(table, 'profiles');
      let operation = 'select';
      const filters = [];

      return {
        select() {
          return this;
        },
        update(changes) {
          operation = 'update';
          calls.profileUpdates.push({ changes, filters });
          return this;
        },
        eq(column, value) {
          filters.push([column, value]);
          return this;
        },
        async limit(limit) {
          assert.equal(limit, 1);

          if (operation === 'update') {
            return { data: [{ id: user.id }], error: null };
          }

          return { data: [profile], error: null };
        }
      };
    }
  };

  const missingCustomer = Object.assign(new Error('No such customer'), {
    type: 'StripeInvalidRequestError',
    code: 'resource_missing',
    param: 'customer'
  });

  const stripe = {
    subscriptions: {
      async list(payload) {
        calls.subscriptionLists.push(payload);
        throw missingCustomer;
      }
    },
    checkout: {
      sessions: {
        async create(payload) {
          calls.checkoutSessions.push(payload);
          return {
            id: 'cs_test_fresh',
            url: 'https://checkout.stripe.test/session',
            status: 'open'
          };
        }
      }
    },
    billingPortal: {
      sessions: {
        async create() {
          throw new Error('billing portal should not be used');
        }
      }
    }
  };

  return {
    stripe,
    supabase,
    calls,
    env: {
      STRIPE_STANDARD_PRICE_ID: 'price_standard',
      STRIPE_PREMIUM_PRICE_ID: 'price_premium',
      NOVELIGHT_APP_URL: 'https://novelight.test'
    }
  };
}

test('free checkout repairs a stale Stripe customer and creates a fresh customer checkout', async (t) => {
  t.mock.method(console, 'warn', () => {});

  const dependencies = createStaleCustomerDependencies();
  const handler = createCheckoutHandler(dependencies);
  const { res, state } = createResponse();

  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: { plan: 'standard' }
    },
    res
  );

  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, {
    url: 'https://checkout.stripe.test/session',
    mode: 'checkout'
  });

  assert.deepEqual(dependencies.calls.subscriptionLists, [
    {
      customer: 'cus_stale',
      status: 'all',
      limit: 100
    }
  ]);

  assert.equal(dependencies.calls.profileUpdates.length, 1);
  assert.deepEqual(dependencies.calls.profileUpdates[0].changes, {
    payment_status: 'canceled',
    stripe_customer_id: null,
    stripe_subscription_id: null,
    stripe_subscription_created_at: null,
    subscription_status: null,
    subscription_cancel_at_period_end: false,
    subscription_current_period_end: null
  });
  assert.deepEqual(dependencies.calls.profileUpdates[0].filters, [
    ['id', 'user-123'],
    ['plan', 'free'],
    ['stripe_customer_id', 'cus_stale']
  ]);

  assert.equal(dependencies.calls.checkoutSessions.length, 1);
  assert.equal(dependencies.calls.checkoutSessions[0].customer, undefined);
  assert.equal(
    dependencies.calls.checkoutSessions[0].customer_email,
    'author@example.com'
  );
});
