import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createStagingBillingReconcileHandler
} from '../api/_lib/staging-billing-reconcile.js';

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

function createDependencies({
  env = {
    VERCEL_ENV: 'preview',
    SUPABASE_URL: 'https://staging-project.supabase.co',
    STRIPE_SECRET_KEY: 'sk_test_example',
    STRIPE_STANDARD_PRICE_ID: 'price_standard',
    STRIPE_PREMIUM_PRICE_ID: 'price_premium'
  },
  user = { id: 'user-123' },
  profile = {
    id: 'user-123',
    plan: 'free',
    stripe_customer_id: null,
    stripe_subscription_id: null
  },
  checkoutSession = {
    id: 'cs_test_example',
    mode: 'subscription',
    customer: 'cus_test_example',
    client_reference_id: 'user-123',
    metadata: { userId: 'user-123' }
  },
  subscription = {
    id: 'sub_test_example',
    status: 'active',
    created: 1_700_000_000,
    cancel_at_period_end: false,
    cancel_at: null,
    items: {
      data: [
        {
          price: { id: 'price_standard' },
          current_period_end: 1_800_000_000
        }
      ]
    }
  }
} = {}) {
  const calls = {
    authTokens: [],
    checkoutSessions: [],
    subscriptionLists: []
  };

  const supabase = {
    auth: {
      async getUser(token) {
        calls.authTokens.push(token);
        return { data: { user }, error: user ? null : new Error('invalid') };
      }
    },
    from(table) {
      assert.equal(table, 'profiles');
      let updatePayload = null;
      const filters = [];

      return {
        select() {
          if (updatePayload) {
            Object.assign(profile, updatePayload);
            return Promise.resolve({ data: [{ id: profile.id }], error: null });
          }
          return this;
        },
        update(payload) {
          updatePayload = payload;
          return this;
        },
        eq(column, value) {
          filters.push([column, value]);
          return this;
        },
        async limit() {
          const matches = filters.every(([column, value]) => {
            if (column === 'id') return profile.id === value;
            if (column === 'stripe_customer_id') {
              return profile.stripe_customer_id === value;
            }
            return false;
          });
          return { data: matches ? [profile] : [], error: null };
        }
      };
    }
  };

  const stripe = {
    checkout: {
      sessions: {
        async retrieve(id) {
          calls.checkoutSessions.push(id);
          return { ...checkoutSession, id };
        }
      }
    },
    subscriptions: {
      async list(payload) {
        calls.subscriptionLists.push(payload);
        return { data: [subscription] };
      }
    }
  };

  return { stripe, supabase, env, profile, calls };
}

async function invoke(
  handler,
  body = { checkoutSessionId: 'cs_test_example' }
) {
  const { res, state } = createResponse();
  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body
    },
    res
  );
  return state;
}

test('rejects non-POST requests', async () => {
  const handler = createStagingBillingReconcileHandler(createDependencies());
  const { res, state } = createResponse();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(state.statusCode, 405);
});

test('fails closed outside an isolated test preview', async () => {
  const unsafeEnvironments = [
    {
      VERCEL_ENV: 'production',
      SUPABASE_URL: 'https://staging-project.supabase.co',
      STRIPE_SECRET_KEY: 'sk_test_example'
    },
    {
      VERCEL_ENV: 'preview',
      SUPABASE_URL: 'https://fiepaguycecrredwrcwx.supabase.co',
      STRIPE_SECRET_KEY: 'sk_test_example'
    },
    {
      VERCEL_ENV: 'preview',
      SUPABASE_URL: 'https://staging-project.supabase.co',
      STRIPE_SECRET_KEY: 'sk_live_example'
    }
  ];

  for (const env of unsafeEnvironments) {
    const dependencies = createDependencies({ env });
    const handler = createStagingBillingReconcileHandler(dependencies);
    const state = await invoke(handler);
    assert.equal(state.statusCode, 404);
    assert.equal(dependencies.calls.authTokens.length, 0);
  }
});

test('requires an authenticated staging user', async () => {
  const dependencies = createDependencies();
  const handler = createStagingBillingReconcileHandler(dependencies);
  const { res, state } = createResponse();
  await handler({ method: 'POST', headers: {}, body: {} }, res);
  assert.equal(state.statusCode, 401);
});

test('rejects a checkout session owned by another user', async () => {
  const dependencies = createDependencies({
    checkoutSession: {
      id: 'cs_test_other',
      mode: 'subscription',
      customer: 'cus_test_other',
      client_reference_id: 'other-user',
      metadata: { userId: 'other-user' }
    }
  });
  const handler = createStagingBillingReconcileHandler(dependencies);
  const state = await invoke(handler, {
    checkoutSessionId: 'cs_test_other'
  });
  assert.equal(state.statusCode, 403);
  assert.equal(dependencies.calls.subscriptionLists.length, 0);
});

test('syncs a Stripe test checkout into the isolated staging profile', async () => {
  const dependencies = createDependencies();
  const handler = createStagingBillingReconcileHandler(dependencies);
  const state = await invoke(handler);

  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, { synced: true, result: 'synced' });
  assert.equal(dependencies.profile.plan, 'standard');
  assert.equal(dependencies.profile.payment_status, 'active');
  assert.equal(dependencies.profile.stripe_customer_id, 'cus_test_example');
  assert.equal(
    dependencies.profile.stripe_subscription_id,
    'sub_test_example'
  );
  assert.deepEqual(dependencies.calls.subscriptionLists, [
    { customer: 'cus_test_example', status: 'all', limit: 100 }
  ]);
});

test(
  'can reconcile later subscription changes from the stored customer',
  async () => {
    const dependencies = createDependencies({
      profile: {
        id: 'user-123',
        plan: 'standard',
        stripe_customer_id: 'cus_test_example',
        stripe_subscription_id: 'sub_test_example'
      },
      subscription: {
        id: 'sub_test_example',
        status: 'active',
        created: 1_700_000_000,
        cancel_at_period_end: true,
        cancel_at: 1_800_000_000,
        items: {
          data: [
            {
              price: { id: 'price_standard' },
              current_period_end: 1_800_000_000
            }
          ]
        }
      }
    });
    const handler = createStagingBillingReconcileHandler(dependencies);
    const state = await invoke(handler, {});

    assert.equal(state.statusCode, 200);
    assert.equal(dependencies.profile.plan, 'standard');
    assert.equal(dependencies.profile.subscription_cancel_at_period_end, true);
  }
);
