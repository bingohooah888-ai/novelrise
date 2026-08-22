import assert from 'node:assert/strict';
import test from 'node:test';

import { processStripeEvent } from '../api/_lib/stripe-webhook.js';

const env = {
  STRIPE_STANDARD_PRICE_ID: 'price_standard',
  STRIPE_PREMIUM_PRICE_ID: 'price_premium'
};

function baseProfile(overrides = {}) {
  return {
    id: 'user-123',
    plan: 'free',
    payment_status: null,
    stripe_customer_id: 'cus_123',
    stripe_subscription_id: null,
    stripe_subscription_created_at: null,
    subscription_status: null,
    subscription_cancel_at_period_end: false,
    subscription_current_period_end: null,
    ...overrides
  };
}

function subscription({
  id = 'sub_123',
  customer = 'cus_123',
  status = 'active',
  priceId = 'price_standard',
  created = 100,
  cancelAtPeriodEnd = false,
  userId = 'user-123'
} = {}) {
  return {
    id,
    customer,
    status,
    created,
    cancel_at_period_end: cancelAtPeriodEnd,
    metadata: userId ? { userId } : {},
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

function createDependencies({ profiles = [baseProfile()], subscriptionsByCustomer = {} } = {}) {
  const storedProfiles = profiles.map((profile) => ({ ...profile }));
  const calls = {
    subscriptionLists: [],
    updates: []
  };

  const supabase = {
    from(table) {
      assert.equal(table, 'profiles');
      let updatePayload = null;
      const filters = [];

      return {
        select() {
          if (!updatePayload) {
            return this;
          }

          const matches = storedProfiles.filter((profile) =>
            filters.every(([column, value]) => profile[column] === value)
          );

          for (const profile of matches) {
            Object.assign(profile, updatePayload);
          }

          calls.updates.push({ ...updatePayload });
          return Promise.resolve({
            data: matches.map((profile) => ({ id: profile.id })),
            error: null
          });
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
          return {
            data: storedProfiles
              .filter((profile) =>
                filters.every(([column, value]) => profile[column] === value)
              )
              .slice(0, limit)
              .map((profile) => ({ ...profile })),
            error: null
          };
        }
      };
    }
  };

  const stripe = {
    subscriptions: {
      async list(payload) {
        calls.subscriptionLists.push(payload);
        return {
          data: subscriptionsByCustomer[payload.customer] ?? []
        };
      }
    }
  };

  return {
    stripe,
    supabase,
    profiles: storedProfiles,
    calls
  };
}

function event(type, object, id = 'evt_1') {
  return {
    id,
    type,
    data: { object }
  };
}

test('checkout completion syncs the actual Stripe subscription rather than trusting requested plan metadata', async () => {
  const dependencies = createDependencies({
    profiles: [baseProfile({ stripe_customer_id: null })],
    subscriptionsByCustomer: {
      cus_new: [
        subscription({
          customer: 'cus_new',
          priceId: 'price_standard'
        })
      ]
    }
  });

  const result = await processStripeEvent({
    ...dependencies,
    event: event('checkout.session.completed', {
      client_reference_id: 'user-123',
      metadata: { userId: 'user-123', plan: 'premium' },
      customer: 'cus_new',
      subscription: 'sub_ignored_snapshot'
    }),
    env
  });

  assert.equal(result, 'synced');
  assert.equal(dependencies.profiles[0].plan, 'standard');
  assert.equal(dependencies.profiles[0].stripe_customer_id, 'cus_new');
  assert.equal(dependencies.profiles[0].stripe_subscription_id, 'sub_123');
});

test('subscription webhook uses Stripe current state, not the possibly stale event snapshot', async () => {
  const dependencies = createDependencies({
    subscriptionsByCustomer: {
      cus_123: [
        subscription({
          id: 'sub_current',
          status: 'active',
          priceId: 'price_premium',
          created: 300
        })
      ]
    }
  });

  await processStripeEvent({
    ...dependencies,
    event: event(
      'customer.subscription.updated',
      subscription({
        id: 'sub_old_snapshot',
        status: 'canceled',
        priceId: 'price_standard',
        created: 100
      })
    ),
    env
  });

  assert.equal(dependencies.profiles[0].plan, 'premium');
  assert.equal(dependencies.profiles[0].stripe_subscription_id, 'sub_current');
  assert.equal(dependencies.profiles[0].subscription_status, 'active');
});

test('delayed cancellation for an old subscription cannot revoke a newer active subscription', async () => {
  const dependencies = createDependencies({
    profiles: [
      baseProfile({
        plan: 'premium',
        stripe_subscription_id: 'sub_new'
      })
    ],
    subscriptionsByCustomer: {
      cus_123: [
        subscription({
          id: 'sub_old',
          status: 'canceled',
          created: 100
        }),
        subscription({
          id: 'sub_new',
          status: 'active',
          priceId: 'price_premium',
          created: 200
        })
      ]
    }
  });

  await processStripeEvent({
    ...dependencies,
    event: event(
      'customer.subscription.deleted',
      subscription({ id: 'sub_old', status: 'canceled', created: 100 })
    ),
    env
  });

  assert.equal(dependencies.profiles[0].plan, 'premium');
  assert.equal(dependencies.profiles[0].stripe_subscription_id, 'sub_new');
});

test('past_due keeps paid access during recovery while marking payment failed', async () => {
  const dependencies = createDependencies({
    subscriptionsByCustomer: {
      cus_123: [
        subscription({
          status: 'past_due',
          priceId: 'price_premium',
          cancelAtPeriodEnd: true
        })
      ]
    }
  });

  await processStripeEvent({
    ...dependencies,
    event: event(
      'customer.subscription.updated',
      subscription({ status: 'past_due', priceId: 'price_premium' })
    ),
    env
  });

  assert.equal(dependencies.profiles[0].plan, 'premium');
  assert.equal(dependencies.profiles[0].payment_status, 'failed');
  assert.equal(
    dependencies.profiles[0].subscription_cancel_at_period_end,
    true
  );
});

test('unpaid or canceled current subscription revokes paid entitlement', async () => {
  for (const status of ['unpaid', 'canceled']) {
    const dependencies = createDependencies({
      profiles: [baseProfile({ plan: 'premium' })],
      subscriptionsByCustomer: {
        cus_123: [subscription({ status, priceId: 'price_premium' })]
      }
    });

    await processStripeEvent({
      ...dependencies,
      event: event(
        status === 'canceled'
          ? 'customer.subscription.deleted'
          : 'customer.subscription.updated',
        subscription({ status, priceId: 'price_premium' })
      ),
      env
    });

    assert.equal(dependencies.profiles[0].plan, 'free');
  }
});

test('an active subscription is canonical over a newer ended subscription', async () => {
  const dependencies = createDependencies({
    subscriptionsByCustomer: {
      cus_123: [
        subscription({
          id: 'sub_active',
          status: 'active',
          priceId: 'price_standard',
          created: 100
        }),
        subscription({
          id: 'sub_canceled_newer',
          status: 'canceled',
          created: 999
        })
      ]
    }
  });

  await processStripeEvent({
    ...dependencies,
    event: event(
      'customer.subscription.deleted',
      subscription({ id: 'sub_canceled_newer', status: 'canceled' })
    ),
    env
  });

  assert.equal(dependencies.profiles[0].plan, 'standard');
  assert.equal(dependencies.profiles[0].stripe_subscription_id, 'sub_active');
});

test('the newest subscription wins when multiple accessible subscriptions exist', async () => {
  const dependencies = createDependencies({
    subscriptionsByCustomer: {
      cus_123: [
        subscription({
          id: 'sub_older',
          priceId: 'price_standard',
          created: 100
        }),
        subscription({
          id: 'sub_newer',
          priceId: 'price_premium',
          created: 200
        })
      ]
    }
  });

  await processStripeEvent({
    ...dependencies,
    event: event('customer.subscription.updated', subscription()),
    env
  });

  assert.equal(dependencies.profiles[0].plan, 'premium');
  assert.equal(dependencies.profiles[0].stripe_subscription_id, 'sub_newer');
});

test('unknown active Stripe price fails closed without changing entitlement', async () => {
  const dependencies = createDependencies({
    subscriptionsByCustomer: {
      cus_123: [subscription({ priceId: 'price_unknown' })]
    }
  });

  await assert.rejects(
    processStripeEvent({
      ...dependencies,
      event: event('customer.subscription.updated', subscription()),
      env
    }),
    /unknown Stripe price/
  );

  assert.equal(dependencies.profiles[0].plan, 'free');
  assert.equal(dependencies.calls.updates.length, 0);
});

test('invoice event also reconciles from current subscription state', async () => {
  const dependencies = createDependencies({
    profiles: [baseProfile({ plan: 'standard', payment_status: 'failed' })],
    subscriptionsByCustomer: {
      cus_123: [subscription({ status: 'active', priceId: 'price_standard' })]
    }
  });

  await processStripeEvent({
    ...dependencies,
    event: event('invoice.payment_failed', { customer: 'cus_123' }),
    env
  });

  assert.equal(dependencies.profiles[0].payment_status, 'active');
  assert.equal(dependencies.profiles[0].plan, 'standard');
});

test('no remaining Stripe subscriptions resets the profile to Free', async () => {
  const dependencies = createDependencies({
    profiles: [baseProfile({ plan: 'standard', payment_status: 'active' })],
    subscriptionsByCustomer: { cus_123: [] }
  });

  const result = await processStripeEvent({
    ...dependencies,
    event: event('customer.subscription.deleted', subscription({ status: 'canceled' })),
    env
  });

  assert.equal(result, 'synced-free');
  assert.equal(dependencies.profiles[0].plan, 'free');
  assert.equal(dependencies.profiles[0].payment_status, 'canceled');
  assert.equal(dependencies.profiles[0].stripe_subscription_id, null);
});

test('subscription metadata can bind a customer before checkout completion arrives', async () => {
  const dependencies = createDependencies({
    profiles: [baseProfile({ stripe_customer_id: null })],
    subscriptionsByCustomer: {
      cus_new: [
        subscription({
          customer: 'cus_new',
          userId: 'user-123',
          priceId: 'price_standard'
        })
      ]
    }
  });

  await processStripeEvent({
    ...dependencies,
    event: event(
      'customer.subscription.created',
      subscription({ customer: 'cus_new', userId: 'user-123' })
    ),
    env
  });

  assert.equal(dependencies.profiles[0].stripe_customer_id, 'cus_new');
  assert.equal(dependencies.profiles[0].plan, 'standard');
});

test('repeated delivery is idempotent because reconciliation writes the same current state', async () => {
  const dependencies = createDependencies({
    subscriptionsByCustomer: {
      cus_123: [subscription({ priceId: 'price_standard' })]
    }
  });
  const repeatedEvent = event('customer.subscription.updated', subscription());

  await processStripeEvent({ ...dependencies, event: repeatedEvent, env });
  await processStripeEvent({ ...dependencies, event: repeatedEvent, env });

  assert.equal(dependencies.profiles[0].plan, 'standard');
  assert.equal(dependencies.profiles[0].stripe_subscription_id, 'sub_123');
  assert.equal(dependencies.calls.updates.length, 2);
});

test('unrelated Stripe events are acknowledged without database changes', async () => {
  const dependencies = createDependencies();

  const result = await processStripeEvent({
    ...dependencies,
    event: event('customer.updated', {}),
    env
  });

  assert.equal(result, 'ignored');
  assert.equal(dependencies.calls.subscriptionLists.length, 0);
  assert.equal(dependencies.calls.updates.length, 0);
});
