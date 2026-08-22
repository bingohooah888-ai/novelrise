import assert from 'node:assert/strict';
import test from 'node:test';

import { createCheckoutHandler } from '../api/_lib/checkout.js';

function createResponse() {
  const state = {
    statusCode: null,
    body: null
  };

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
  user = {
    id: 'user-123',
    email: 'author@example.com'
  },
  authError = null,
  env = {
    STRIPE_STANDARD_PRICE_ID: 'price_standard',
    STRIPE_PREMIUM_PRICE_ID: 'price_premium'
  },
  checkout = async () => ({
    url: 'https://checkout.stripe.test/session'
  })
} = {}) {
  const calls = {
    tokens: [],
    checkoutSessions: []
  };

  const supabase = {
    auth: {
      async getUser(token) {
        calls.tokens.push(token);
        return {
          data: { user },
          error: authError
        };
      }
    }
  };

  const stripe = {
    checkout: {
      sessions: {
        async create(payload) {
          calls.checkoutSessions.push(payload);
          return checkout(payload);
        }
      }
    }
  };

  return {
    stripe,
    supabase,
    env,
    calls
  };
}

test('rejects non-POST requests', async () => {
  const handler = createCheckoutHandler({});
  const { res, state } = createResponse();

  await handler(
    {
      method: 'GET',
      headers: {}
    },
    res
  );

  assert.equal(state.statusCode, 405);
  assert.deepEqual(state.body, {
    error: 'Method not allowed'
  });
});

test('rejects missing or malformed bearer tokens', async () => {
  const authorizationValues = [undefined, '', 'Basic abc', 'Bearer'];

  for (const authorization of authorizationValues) {
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
    assert.deepEqual(state.body, {
      error: 'Unauthorized'
    });
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
      headers: {
        authorization: 'Bearer token-123'
      },
      body: { plan: 'standard' }
    },
    res
  );

  assert.equal(state.statusCode, 401);
  assert.deepEqual(state.body, {
    error: 'Unauthorized'
  });
  assert.deepEqual(dependencies.calls.tokens, ['token-123']);
});

test('rejects plans outside Standard and Premium', async () => {
  const dependencies = createDependencies();
  const handler = createCheckoutHandler(dependencies);
  const { res, state } = createResponse();

  await handler(
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-123'
      },
      body: { plan: 'free' }
    },
    res
  );

  assert.equal(state.statusCode, 400);
  assert.deepEqual(state.body, {
    error: 'Invalid plan'
  });
  assert.equal(dependencies.calls.checkoutSessions.length, 0);
});

test('creates Stripe checkout sessions with trusted user metadata', async () => {
  for (const [plan, expectedPrice] of [
    ['standard', 'price_standard'],
    ['premium', 'price_premium']
  ]) {
    const dependencies = createDependencies();
    const handler = createCheckoutHandler(dependencies);
    const { res, state } = createResponse();

    await handler(
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-123'
        },
        body: { plan }
      },
      res
    );

    assert.equal(state.statusCode, 200);
    assert.deepEqual(state.body, {
      url: 'https://checkout.stripe.test/session'
    });
    assert.equal(dependencies.calls.checkoutSessions.length, 1);

    const payload = dependencies.calls.checkoutSessions[0];
    assert.equal(payload.mode, 'subscription');
    assert.equal(payload.customer_email, 'author@example.com');
    assert.equal(payload.client_reference_id, 'user-123');
    assert.deepEqual(payload.metadata, {
      userId: 'user-123',
      plan
    });
    assert.deepEqual(payload.line_items, [
      {
        price: expectedPrice,
        quantity: 1
      }
    ]);
  }
});

test('returns a generic error when Stripe checkout creation fails', async (t) => {
  t.mock.method(console, 'error', () => {});

  const dependencies = createDependencies({
    checkout: async () => {
      throw new Error('Stripe unavailable');
    }
  });
  const handler = createCheckoutHandler(dependencies);
  const { res, state } = createResponse();

  await handler(
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-123'
      },
      body: { plan: 'standard' }
    },
    res
  );

  assert.equal(state.statusCode, 500);
  assert.deepEqual(state.body, {
    error: 'Checkout session creation failed'
  });
});
