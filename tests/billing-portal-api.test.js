import assert from 'node:assert/strict';
import test from 'node:test';

import { createBillingPortalHandler } from '../api/_lib/billing-portal.js';

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
  user = { id: 'user-123' },
  authError = null,
  profile = { stripe_customer_id: 'cus_123' },
  profileError = null,
  portal = async () => ({
    url: 'https://billing.stripe.test/session'
  })
} = {}) {
  const calls = {
    tokens: [],
    portalSessions: []
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
    billingPortal: {
      sessions: {
        async create(payload) {
          calls.portalSessions.push(payload);
          return portal(payload);
        }
      }
    }
  };

  return {
    stripe,
    supabase,
    env: {
      NOVELIGHT_APP_URL: 'https://novelight.test/'
    },
    calls
  };
}

test('billing portal requires POST and authentication', async () => {
  const handler = createBillingPortalHandler({});
  const first = createResponse();

  await handler({ method: 'GET', headers: {} }, first.res);
  assert.equal(first.state.statusCode, 405);

  const dependencies = createDependencies();
  const authenticatedHandler = createBillingPortalHandler(dependencies);
  const second = createResponse();

  await authenticatedHandler({ method: 'POST', headers: {} }, second.res);

  assert.equal(second.state.statusCode, 401);
  assert.equal(dependencies.calls.tokens.length, 0);
});

test('billing portal rejects invalid sessions', async () => {
  const dependencies = createDependencies({
    user: null,
    authError: new Error('bad token')
  });
  const handler = createBillingPortalHandler(dependencies);
  const { res, state } = createResponse();

  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' }
    },
    res
  );

  assert.equal(state.statusCode, 401);
});

test('billing portal requires an existing Stripe customer', async () => {
  const dependencies = createDependencies({
    profile: { stripe_customer_id: null }
  });
  const handler = createBillingPortalHandler(dependencies);
  const { res, state } = createResponse();

  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' }
    },
    res
  );

  assert.equal(state.statusCode, 409);
  assert.deepEqual(state.body, {
    error: 'No Stripe billing account exists for this user',
    code: 'NO_BILLING_ACCOUNT'
  });
  assert.equal(dependencies.calls.portalSessions.length, 0);
});

test('billing portal creates a short-lived session for the authenticated customer', async () => {
  const dependencies = createDependencies();
  const handler = createBillingPortalHandler(dependencies);
  const { res, state } = createResponse();

  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' }
    },
    res
  );

  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, {
    url: 'https://billing.stripe.test/session'
  });
  assert.deepEqual(dependencies.calls.portalSessions, [
    {
      customer: 'cus_123',
      return_url: 'https://novelight.test/mypage.html'
    }
  ]);
});

test('billing portal returns a generic error for upstream failures', async (t) => {
  t.mock.method(console, 'error', () => {});

  const dependencies = createDependencies({
    portal: async () => {
      throw new Error('Stripe unavailable');
    }
  });
  const handler = createBillingPortalHandler(dependencies);
  const { res, state } = createResponse();

  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' }
    },
    res
  );

  assert.equal(state.statusCode, 500);
  assert.deepEqual(state.body, {
    error: 'Billing portal session creation failed'
  });
});
