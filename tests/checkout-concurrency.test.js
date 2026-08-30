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

function request(plan = 'standard') {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer token-123' },
    body: { plan }
  };
}

function createConcurrentDependencies({
  initialAttempt = null,
  retrieveSession = async (sessionId) => ({
    id: sessionId,
    status: 'open',
    url: 'https://checkout.stripe.test/reused'
  }),
  createSession
} = {}) {
  const user = { id: 'user-race', email: 'race@example.com' };
  const attempts = new Map();
  if (initialAttempt) {
    attempts.set(user.id, { ...initialAttempt });
  }

  const calls = {
    backendCreates: 0,
    createOptions: [],
    releases: 0,
    retrieves: []
  };
  const stripeByIdempotencyKey = new Map();

  const supabase = {
    auth: {
      async getUser() {
        return { data: { user }, error: null };
      }
    },
    from(table) {
      assert.equal(table, 'profiles');
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async limit() {
          return {
            data: [{ plan: 'free', stripe_customer_id: null }],
            error: null
          };
        }
      };
    },
    async rpc(name, args) {
      if (name === 'novelight_reserve_checkout_attempt') {
        const current = attempts.get(args.p_user_id);
        if (current && current.plan !== args.p_plan) {
          return {
            data: null,
            error: { message: 'checkout_attempt_plan_conflict' }
          };
        }

        const attempt =
          current ??
          {
            attempt_id: args.p_candidate_attempt_id,
            plan: args.p_plan,
            stripe_session_id: null,
            expires_at: '2099-01-01T00:00:00.000Z'
          };
        attempts.set(args.p_user_id, attempt);
        return { data: [{ ...attempt }], error: null };
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
          calls.releases += 1;
          return { data: true, error: null };
        }
        return { data: false, error: null };
      }

      throw new Error(`Unexpected RPC ${name}`);
    }
  };

  const stripe = {
    subscriptions: {
      async list() {
        return { data: [] };
      }
    },
    checkout: {
      sessions: {
        async create(payload, options) {
          calls.createOptions.push(options);
          const key = options?.idempotencyKey;
          if (!key) {
            calls.backendCreates += 1;
            return {
              id: `cs_test_unkeyed_${calls.backendCreates}`,
              status: 'open',
              url: `https://checkout.stripe.test/unkeyed-${calls.backendCreates}`
            };
          }

          if (!stripeByIdempotencyKey.has(key)) {
            calls.backendCreates += 1;
            stripeByIdempotencyKey.set(
              key,
              Promise.resolve().then(() =>
                createSession
                  ? createSession(payload, options, calls.backendCreates)
                  : {
                      id: `cs_test_keyed_${calls.backendCreates}`,
                      status: 'open',
                      url: `https://checkout.stripe.test/keyed-${calls.backendCreates}`
                    }
              )
            );
          }
          return stripeByIdempotencyKey.get(key);
        },
        async retrieve(sessionId) {
          calls.retrieves.push(sessionId);
          return retrieveSession(sessionId);
        }
      }
    },
    billingPortal: {
      sessions: {
        async create() {
          throw new Error('Portal should not be used');
        }
      }
    }
  };

  return {
    stripe,
    supabase,
    calls,
    attempts,
    env: {
      STRIPE_STANDARD_PRICE_ID: 'price_standard',
      STRIPE_PREMIUM_PRICE_ID: 'price_premium',
      NOVELIGHT_APP_URL: 'https://novelight.test'
    }
  };
}

test('concurrent first Checkout requests create only one completable Stripe session', async () => {
  const dependencies = createConcurrentDependencies();
  const handler = createCheckoutHandler(dependencies);
  const first = createResponse();
  const second = createResponse();

  await Promise.all([
    handler(request('standard'), first.res),
    handler(request('standard'), second.res)
  ]);

  assert.equal(first.state.statusCode, 200);
  assert.equal(second.state.statusCode, 200);
  assert.equal(first.state.body.url, second.state.body.url);
  assert.equal(dependencies.calls.backendCreates, 1);
  assert.equal(dependencies.calls.createOptions.length, 2);
  assert.equal(
    dependencies.calls.createOptions[0].idempotencyKey,
    dependencies.calls.createOptions[1].idempotencyKey
  );
});

test('simultaneous plan changes fail closed instead of creating two sessions', async (t) => {
  t.mock.method(console, 'error', () => {});

  const dependencies = createConcurrentDependencies();
  const handler = createCheckoutHandler(dependencies);
  const standard = createResponse();
  const premium = createResponse();

  await Promise.all([
    handler(request('standard'), standard.res),
    handler(request('premium'), premium.res)
  ]);

  const statuses = [standard.state.statusCode, premium.state.statusCode].sort();
  assert.deepEqual(statuses, [200, 409]);
  assert.equal(dependencies.calls.backendCreates, 1);
});

test('a transient Stripe creation failure retries the same durable attempt safely', async (t) => {
  t.mock.method(console, 'error', () => {});

  let createCalls = 0;
  const dependencies = createConcurrentDependencies({
    createSession: async () => {
      createCalls += 1;
      if (createCalls === 1) {
        throw new Error('temporary Stripe transport failure');
      }
      return {
        id: 'cs_test_retry',
        status: 'open',
        url: 'https://checkout.stripe.test/retry'
      };
    }
  });

  dependencies.stripe.checkout.sessions.create = async (payload, options) => {
    dependencies.calls.createOptions.push(options);
    createCalls += 1;
    if (createCalls === 1) {
      throw new Error('temporary Stripe transport failure');
    }
    dependencies.calls.backendCreates += 1;
    return {
      id: 'cs_test_retry',
      status: 'open',
      url: 'https://checkout.stripe.test/retry'
    };
  };

  const handler = createCheckoutHandler(dependencies);
  const failed = createResponse();
  const retried = createResponse();

  await handler(request(), failed.res);
  await handler(request(), retried.res);

  assert.equal(failed.state.statusCode, 500);
  assert.equal(retried.state.statusCode, 200);
  assert.equal(retried.state.body.url, 'https://checkout.stripe.test/retry');
  assert.equal(
    dependencies.calls.createOptions[0].idempotencyKey,
    dependencies.calls.createOptions[1].idempotencyKey
  );
  assert.equal(dependencies.calls.backendCreates, 1);
});

test('an expired stored Checkout session is released and replaced once', async () => {
  const dependencies = createConcurrentDependencies({
    initialAttempt: {
      attempt_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      plan: 'standard',
      stripe_session_id: 'cs_test_expired',
      expires_at: '2099-01-01T00:00:00.000Z'
    },
    retrieveSession: async () => ({
      id: 'cs_test_expired',
      status: 'expired',
      url: null
    })
  });
  const handler = createCheckoutHandler(dependencies);
  const response = createResponse();

  await handler(request(), response.res);

  assert.equal(response.state.statusCode, 200);
  assert.equal(dependencies.calls.retrieves.length, 1);
  assert.equal(dependencies.calls.releases, 1);
  assert.equal(dependencies.calls.backendCreates, 1);
  assert.notEqual(
    dependencies.attempts.get('user-race').attempt_id,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
});
