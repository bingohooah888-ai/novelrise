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

function createDependencies({
  user = { id: 'user-123', email: 'author@example.com' },
  authError = null,
  profile = { plan: 'free', stripe_customer_id: null },
  profileError = null,
  existingSubscriptions = [],
  env = {
    STRIPE_STANDARD_PRICE_ID: 'price_standard',
    STRIPE_PREMIUM_PRICE_ID: 'price_premium',
    NOVELIGHT_APP_URL: 'https://novelight.test'
  },
  checkout = async () => ({ url: 'https://checkout.stripe.test/session' }),
  portal = async () => ({ url: 'https://billing.stripe.test/session' })
} = {}) {
  const calls = {
    tokens: [],
    checkoutSessions: [],
    portalSessions: [],
    subscriptionLists: []
  };

  const supabase = {
    auth: {
      async getUser(token) {
        calls.tokens.push(token);
        return { data: { user }, error: authError };
      }
    },
    from(table) {
      assert.equal(table, 'profiles');
      return {
        select() {
          return this;
        },
        eq(column, value) {
          assert.equal(column, 'id');
          assert.equal(value, user?.id);
          return this;
        },
        async limit(limit) {
          assert.equal(limit, 1);
          return {
            data: profile ? [profile] : [],
            error: profileError
          };
        }
      };
    }
  };

  const stripe = {
    subscriptions: {
      async list(payload) {
        calls.subscriptionLists.push(payload);
        return { data: existingSubscriptions };
      }
    },
    checkout: {
      sessions: {
        async create(payload) {
          calls.checkoutSessions.push(payload);
          return checkout(payload);
        }
      }
    },
    billingPortal: {
      sessions: {
        async create(payload) {
          calls.portalSessions.push(payload);
          return portal(payload);
        }
      }
    }
  };

  return { stripe, supabase, env, calls };
}

test('rejects non-POST requests', async () => {
  const handler = createCheckoutHandler({});
  const { res, state } = createResponse();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(state.statusCode, 405);
  assert.deepEqual(state.body, { error: 'Method not allowed' });
});

test('rejects missing or malformed bearer tokens', async () => {
  for (const authorization of [undefined, '', 'Basic abc', 'Bearer']) {
    const dependencies = createDependencies();
    const handler = createCheckoutHandler(dependencies);
    const { res, state } = createResponse();

    await handler(
      {
        method: 'POST',
        headers: { authorization },
        body: { plan: 'standard' }
      },
      res
    );

    assert.equal(state.statusCode, 401);
    assert.equal(dependencies.calls.tokens.length, 0);
  }
});

test('rejects users that Supabase cannot authenticate', async () => {
  const dependencies = createDependencies({
    user: null,
    authError: new Error('Invalid token')
  });
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

  assert.equal(state.statusCode, 401);
});

test('rejects plans outside Standard and Premium', async () => {
  const dependencies = createDependencies();
  const handler = createCheckoutHandler(dependencies);
  const { res, state } = createResponse();

  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: { plan: 'free' }
    },
    res
  );

  assert.equal(state.statusCode, 400);
  assert.deepEqual(state.body, { error: 'Invalid plan' });
  assert.equal(dependencies.calls.checkoutSessions.length, 0);
});

test('paid users are redirected to the billing portal', async () => {
  const dependencies = createDependencies({
    profile: { plan: 'standard', stripe_customer_id: 'cus_existing' }
  });
  const handler = createCheckoutHandler(dependencies);
  const { res, state } = createResponse();

  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: { plan: 'premium' }
    },
    res
  );

  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, {
    url: 'https://billing.stripe.test/session',
    mode: 'portal'
  });
  assert.deepEqual(dependencies.calls.portalSessions, [
    {
      customer: 'cus_existing',
      return_url: 'https://novelight.test/pricing.html'
    }
  ]);
  assert.equal(dependencies.calls.subscriptionLists.length, 0);
  assert.equal(dependencies.calls.checkoutSessions.length, 0);
});

test('Stripe-side pending or active subscription blocks a duplicate checkout during webhook lag', async () => {
  for (const status of [
    'active',
    'trialing',
    'past_due',
    'unpaid',
    'incomplete',
    'paused'
  ]) {
    const dependencies = createDependencies({
      profile: { plan: 'free', stripe_customer_id: 'cus_existing' },
      existingSubscriptions: [{ id: `sub_${status}`, status }]
    });
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
    assert.equal(state.body.mode, 'portal');
    assert.equal(dependencies.calls.checkoutSessions.length, 0);
  }
});

test('creates a subscription checkout with trusted metadata', async () => {
  const dependencies = createDependencies();
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

  const payload = dependencies.calls.checkoutSessions[0];
  assert.equal(payload.mode, 'subscription');
  assert.equal(payload.customer_email, 'author@example.com');
  assert.equal(payload.customer, undefined);
  assert.equal(payload.client_reference_id, 'user-123');
  assert.deepEqual(payload.subscription_data.metadata, {
    userId: 'user-123',
    plan: 'standard'
  });
  assert.equal(payload.line_items[0].price, 'price_standard');
  assert.equal(
    payload.success_url,
    'https://novelight.test/mypage.html?checkout=success'
  );
});

test('reuses an existing customer when only ended subscriptions remain', async () => {
  const dependencies = createDependencies({
    profile: { plan: 'free', stripe_customer_id: 'cus_existing' },
    existingSubscriptions: [
      { id: 'sub_old', status: 'canceled' },
      { id: 'sub_expired', status: 'incomplete_expired' }
    ]
  });
  const handler = createCheckoutHandler(dependencies);
  const { res, state } = createResponse();

  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: { plan: 'premium' }
    },
    res
  );

  assert.equal(state.statusCode, 200);
  assert.equal(state.body.mode, 'checkout');
  const payload = dependencies.calls.checkoutSessions[0];
  assert.equal(payload.customer, 'cus_existing');
  assert.equal(payload.customer_email, undefined);
  assert.equal(payload.line_items[0].price, 'price_premium');
});

test('returns a generic error when profile lookup or Stripe fails', async (t) => {
  t.mock.method(console, 'error', () => {});

  for (const dependencies of [
    createDependencies({ profileError: new Error('database unavailable') }),
    createDependencies({
      checkout: async () => {
        throw new Error('Stripe unavailable');
      }
    }),
    createDependencies({
      profile: { plan: 'premium', stripe_customer_id: 'cus_existing' },
      portal: async () => {
        throw new Error('Portal unavailable');
      }
    })
  ]) {
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

    assert.equal(state.statusCode, 500);
    assert.deepEqual(state.body, {
      error: 'Checkout session creation failed'
    });
  }
});
