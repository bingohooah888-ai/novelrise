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
  profile = {
    plan: 'free',
    payment_status: 'active',
    stripe_customer_id: null,
    subscription_status: null
  },
  profileError = null,
  existingSubscriptions = [],
  env = {
    STRIPE_STANDARD_PRICE_ID: 'price_standard',
    STRIPE_PREMIUM_PRICE_ID: 'price_premium',
    NOVELIGHT_APP_URL: 'https://novelight.test'
  },
  checkout = async () => ({
    id: 'cs_test_session',
    url: 'https://checkout.stripe.test/session',
    status: 'open'
  }),
  retrieveCheckout = async (sessionId) => ({
    id: sessionId,
    url: 'https://checkout.stripe.test/session',
    status: 'open'
  }),
  portal = async () => ({ url: 'https://billing.stripe.test/session' })
} = {}) {
  const calls = {
    tokens: [],
    checkoutSessions: [],
    checkoutSessionOptions: [],
    checkoutSessionRetrievals: [],
    checkoutRpcs: [],
    portalSessions: [],
    subscriptionLists: []
  };
  const attempts = new Map();

  const supabase = {
    auth: {
      async getUser(token) {
        calls.tokens.push(token);
        return { data: { user }, error: authError };
      }
    },
    async rpc(name, args) {
      calls.checkoutRpcs.push({ name, args });

      if (name === 'novelight_reserve_checkout_attempt') {
        const current = attempts.get(args.p_user_id);

        if (current && current.plan !== args.p_plan) {
          return {
            data: null,
            error: { message: 'checkout_attempt_plan_conflict' }
          };
        }

        const attempt = current ?? {
          attempt_id: args.p_candidate_attempt_id,
          plan: args.p_plan,
          stripe_session_id: null,
          expires_at: '2099-01-01T00:00:00.000Z'
        };
        attempts.set(args.p_user_id, attempt);
        return { data: [attempt], error: null };
      }

      if (name === 'novelight_attach_checkout_session') {
        const current = attempts.get(args.p_user_id);
        if (!current || current.attempt_id !== args.p_attempt_id) {
          return {
            data: null,
            error: { message: 'checkout_attempt_not_current' }
          };
        }
        current.stripe_session_id = args.p_stripe_session_id;
        return { data: true, error: null };
      }

      if (name === 'novelight_release_checkout_attempt') {
        const current = attempts.get(args.p_user_id);
        if (current?.attempt_id === args.p_attempt_id) {
          attempts.delete(args.p_user_id);
          return { data: true, error: null };
        }
        return { data: false, error: null };
      }

      throw new Error(`Unexpected RPC ${name}`);
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
        async create(payload, options) {
          calls.checkoutSessions.push(payload);
          calls.checkoutSessionOptions.push(options);
          return checkout(payload, options);
        },
        async retrieve(sessionId) {
          calls.checkoutSessionRetrievals.push(sessionId);
          return retrieveCheckout(sessionId);
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
        body: { plan: 'premium' }
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
      body: { plan: 'premium' }
    },
    res
  );

  assert.equal(state.statusCode, 401);
});

test('Stripe checkout accepts Premium only during the beta', async () => {
  for (const plan of ['free', 'standard']) {
    const dependencies = createDependencies();
    const handler = createCheckoutHandler(dependencies);
    const { res, state } = createResponse();

    await handler(
      {
        method: 'POST',
        headers: { authorization: 'Bearer token-123' },
        body: { plan }
      },
      res
    );

    assert.equal(state.statusCode, 400);
    assert.deepEqual(state.body, { error: 'Invalid plan' });
    assert.equal(dependencies.calls.checkoutSessions.length, 0);
  }
});

test('paid users are redirected to the billing portal', async () => {
  const dependencies = createDependencies({
    profile: {
      plan: 'standard',
      payment_status: 'active',
      stripe_customer_id: 'cus_existing',
      subscription_status: 'active'
    }
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

test('beta-free Standard can upgrade to Premium without a Stripe customer', async () => {
  const dependencies = createDependencies({
    profile: {
      plan: 'standard',
      payment_status: 'beta_free',
      stripe_customer_id: null,
      subscription_status: null
    }
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
  assert.equal(dependencies.calls.checkoutSessions[0].line_items[0].price, 'price_premium');
});

test('Stripe-side pending or active subscription blocks a duplicate Premium checkout during webhook lag', async () => {
  for (const status of [
    'active',
    'trialing',
    'past_due',
    'unpaid',
    'incomplete',
    'paused'
  ]) {
    const dependencies = createDependencies({
      profile: {
        plan: 'free',
        payment_status: 'active',
        stripe_customer_id: 'cus_existing',
        subscription_status: null
      },
      existingSubscriptions: [{ id: `sub_${status}`, status }]
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
    assert.equal(state.body.mode, 'portal');
    assert.equal(dependencies.calls.checkoutSessions.length, 0);
  }
});

test('creates a Premium subscription checkout with trusted metadata and attempt idempotency', async () => {
  const dependencies = createDependencies();
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
    plan: 'premium'
  });
  assert.equal(payload.line_items[0].price, 'price_premium');
  assert.equal(
    payload.success_url,
    'https://novelight.test/mypage.html?checkout=success'
  );
  assert.ok(Number.isInteger(payload.expires_at));
  assert.match(
    dependencies.calls.checkoutSessionOptions[0].idempotencyKey,
    /^novelight-checkout:user-123:[0-9a-f-]{36}$/
  );
});

test('Premium checkout confirmation discloses the beta price and normal price', async () => {
  const dependencies = createDependencies();
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
  const message = dependencies.calls.checkoutSessions[0].custom_text.submit.message;
  assert.match(message, /β版特別価格/);
  assert.match(message, /月額480円/);
  assert.match(message, /月額1,980円/);
  assert.match(message, /毎月自動更新/);
  assert.match(message, /Stripe顧客ポータル/);
  assert.match(message, /途中返金・日割り返金は原則行いません/);
  assert.match(message, /18歳未満.*法定代理人の同意/);
});

test('reuses an existing customer when only ended subscriptions remain', async () => {
  const dependencies = createDependencies({
    profile: {
      plan: 'free',
      payment_status: 'canceled',
      stripe_customer_id: 'cus_existing',
      subscription_status: 'canceled'
    },
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
      profile: {
        plan: 'premium',
        payment_status: 'active',
        stripe_customer_id: 'cus_existing',
        subscription_status: 'active'
      },
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
        body: { plan: 'premium' }
      },
      res
    );

    assert.equal(state.statusCode, 500);
    assert.deepEqual(state.body, {
      error: 'Checkout session creation failed'
    });
  }
});
