import assert from 'node:assert/strict';
import test from 'node:test';

import { createCheckoutHandler } from '../api/_lib/checkout.js';

function responseState() {
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

function paidDependencies(portalError) {
  const supabase = {
    auth: {
      async getUser() {
        return {
          data: { user: { id: 'user-paid', email: 'paid@example.com' } },
          error: null
        };
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
            data: [
              {
                plan: 'premium',
                payment_status: 'active',
                stripe_customer_id: 'cus_missing',
                subscription_status: 'active'
              }
            ],
            error: null
          };
        }
      };
    }
  };

  return {
    supabase,
    stripe: {
      billingPortal: {
        sessions: {
          async create() {
            throw portalError;
          }
        }
      }
    },
    env: {
      STRIPE_PREMIUM_PRICE_ID: 'price_premium',
      NOVELIGHT_APP_URL: 'https://novelight.test'
    }
  };
}

test('paid Premium profile pointing at a missing Stripe customer returns an actionable 409', async (t) => {
  t.mock.method(console, 'error', () => {});
  const stripeError = Object.assign(new Error('No such customer'), {
    name: 'Error',
    type: 'StripeInvalidRequestError',
    code: 'resource_missing',
    param: 'customer'
  });
  const handler = createCheckoutHandler(paidDependencies(stripeError));
  const { res, state } = responseState();
  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: { plan: 'premium' }
    },
    res
  );
  assert.equal(state.statusCode, 409);
  assert.deepEqual(state.body, {
    error: 'Billing account needs repair',
    code: 'billing_state_conflict'
  });
});

test('unrelated portal failures remain generic server errors', async (t) => {
  t.mock.method(console, 'error', () => {});
  const handler = createCheckoutHandler(
    paidDependencies(new Error('Portal unavailable'))
  );
  const { res, state } = responseState();
  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: { plan: 'premium' }
    },
    res
  );
  assert.equal(state.statusCode, 500);
  assert.deepEqual(state.body, { error: 'Checkout session creation failed' });
});
