import assert from 'node:assert/strict';
import test from 'node:test';

import { processStripeEvent } from '../api/_lib/stripe-webhook.js';

const env = {
  STRIPE_STANDARD_PRICE_ID: 'price_standard',
  STRIPE_PREMIUM_PRICE_ID: 'price_premium'
};

function subscription({
  status = 'active',
  cancelAtPeriodEnd = true,
  priceId = 'price_standard'
} = {}) {
  return {
    id: 'sub_cancel_at_period_end',
    customer: 'cus_cancel_at_period_end',
    status,
    created: 100,
    cancel_at_period_end: cancelAtPeriodEnd,
    metadata: { userId: 'user-cancel-at-period-end' },
    items: {
      data: [
        {
          current_period_end: 1893456000,
          price: { id: priceId }
        }
      ]
    }
  };
}

function dependencies() {
  const profile = {
    id: 'user-cancel-at-period-end',
    plan: 'standard',
    payment_status: 'active',
    stripe_customer_id: 'cus_cancel_at_period_end',
    stripe_subscription_id: 'sub_cancel_at_period_end'
  };

  const supabase = {
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
        async limit(limit) {
          assert.equal(limit, 2);
          const matches = filters.every(([column, value]) => profile[column] === value);
          return { data: matches ? [{ ...profile }] : [], error: null };
        }
      };
    }
  };

  const stripe = {
    subscriptions: {
      async list({ customer, status, limit }) {
        assert.equal(customer, 'cus_cancel_at_period_end');
        assert.equal(status, 'all');
        assert.equal(limit, 100);
        return { data: [subscription()] };
      }
    }
  };

  return { stripe, supabase, profile };
}

test('active subscription scheduled to cancel keeps Standard access until period end', async () => {
  const deps = dependencies();

  const result = await processStripeEvent({
    ...deps,
    event: {
      id: 'evt_cancel_at_period_end',
      type: 'customer.subscription.updated',
      data: { object: subscription() }
    },
    env
  });

  assert.equal(result, 'synced');
  assert.equal(deps.profile.plan, 'standard');
  assert.equal(deps.profile.payment_status, 'active');
  assert.equal(deps.profile.subscription_status, 'active');
  assert.equal(deps.profile.subscription_cancel_at_period_end, true);
  assert.equal(
    deps.profile.subscription_current_period_end,
    '2030-01-01T00:00:00.000Z'
  );
});
