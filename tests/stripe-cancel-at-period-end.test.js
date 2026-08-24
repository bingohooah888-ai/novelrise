import assert from 'node:assert/strict';
import test from 'node:test';

import { processStripeEvent } from '../api/_lib/stripe-webhook.js';

const env = {
  STRIPE_STANDARD_PRICE_ID: 'price_standard',
  STRIPE_PREMIUM_PRICE_ID: 'price_premium'
};

const periodEnd = 1893456000;

function subscription({
  status = 'active',
  cancelAtPeriodEnd = true,
  cancelAt = null,
  priceId = 'price_standard'
} = {}) {
  return {
    id: 'sub_cancel_at_period_end',
    customer: 'cus_cancel_at_period_end',
    status,
    created: 100,
    cancel_at_period_end: cancelAtPeriodEnd,
    cancel_at: cancelAt,
    metadata: { userId: 'user-cancel-at-period-end' },
    items: {
      data: [
        {
          current_period_end: periodEnd,
          price: { id: priceId }
        }
      ]
    }
  };
}

function dependencies(subscriptionOverrides = {}) {
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
          const matches = filters.every(
            ([column, value]) => profile[column] === value
          );
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
        return { data: [subscription(subscriptionOverrides)] };
      }
    }
  };

  return { stripe, supabase, profile };
}

async function sync(deps, subscriptionOverrides = {}) {
  return processStripeEvent({
    ...deps,
    event: {
      id: 'evt_cancel_at_period_end',
      type: 'customer.subscription.updated',
      data: { object: subscription(subscriptionOverrides) }
    },
    env
  });
}

test('active subscription scheduled to cancel keeps Standard access until period end', async () => {
  const deps = dependencies();

  const result = await sync(deps);

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

test('Stripe cancel_at matching current period end is treated as scheduled period-end cancellation', async () => {
  const overrides = {
    cancelAtPeriodEnd: false,
    cancelAt: periodEnd
  };
  const deps = dependencies(overrides);

  const result = await sync(deps, overrides);

  assert.equal(result, 'synced');
  assert.equal(deps.profile.plan, 'standard');
  assert.equal(deps.profile.payment_status, 'active');
  assert.equal(deps.profile.subscription_status, 'active');
  assert.equal(deps.profile.subscription_cancel_at_period_end, true);
});

test('Stripe cancel_at beyond current period is not treated as current-period cancellation', async () => {
  const overrides = {
    cancelAtPeriodEnd: false,
    cancelAt: periodEnd + 86400
  };
  const deps = dependencies(overrides);

  const result = await sync(deps, overrides);

  assert.equal(result, 'synced');
  assert.equal(deps.profile.plan, 'standard');
  assert.equal(deps.profile.payment_status, 'active');
  assert.equal(deps.profile.subscription_status, 'active');
  assert.equal(deps.profile.subscription_cancel_at_period_end, false);
});
