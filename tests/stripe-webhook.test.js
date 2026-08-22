import assert from 'node:assert/strict';
import test from 'node:test';

import { processStripeEvent } from '../api/_lib/stripe-webhook.js';

const env = {
  STRIPE_STANDARD_PRICE_ID: 'price_standard',
  STRIPE_PREMIUM_PRICE_ID: 'price_premium'
};

function createSupabase(initialProfiles) {
  const profiles = initialProfiles.map((profile) => ({ ...profile }));
  const calls = {
    updates: []
  };

  return {
    calls,
    profiles,
    from(table) {
      assert.equal(table, 'profiles');

      let updatePayload = null;
      const filters = [];

      const query = {
        select() {
          if (!updatePayload) {
            return this;
          }

          const profile = profiles.find((candidate) =>
            filters.every(([column, value]) => candidate[column] === value)
          );

          if (!profile) {
            return Promise.resolve({ data: [], error: null });
          }

          const previousEventCreated = profile.stripe_last_event_created_at;
          const incomingEventCreated = updatePayload.stripe_last_event_created_at;

          if (
            Number.isInteger(previousEventCreated) &&
            previousEventCreated > incomingEventCreated
          ) {
            return Promise.resolve({ data: [], error: null });
          }

          Object.assign(profile, updatePayload);
          calls.updates.push({ ...updatePayload });

          return Promise.resolve({
            data: [{ id: profile.id }],
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
        or() {
          return this;
        },
        async limit(limit) {
          assert.equal(limit, 2);
          return {
            data: profiles
              .filter((candidate) =>
                filters.every(([column, value]) => candidate[column] === value)
              )
              .slice(0, limit)
              .map((profile) => ({ ...profile })),
            error: null
          };
        }
      };

      return query;
    }
  };
}

function baseProfile(overrides = {}) {
  return {
    id: 'user-123',
    plan: 'free',
    stripe_customer_id: 'cus_123',
    stripe_subscription_id: null,
    stripe_last_event_id: null,
    stripe_last_event_created_at: null,
    ...overrides
  };
}

function subscriptionEvent({
  id = 'evt_1',
  created = 100,
  type = 'customer.subscription.updated',
  status = 'active',
  priceId = 'price_standard',
  cancelAtPeriodEnd = false,
  customer = 'cus_123',
  subscriptionId = 'sub_123'
} = {}) {
  return {
    id,
    created,
    type,
    data: {
      object: {
        id: subscriptionId,
        customer,
        status,
        cancel_at_period_end: cancelAtPeriodEnd,
        items: {
          data: [
            {
              current_period_end: 1893456000,
              price: { id: priceId }
            }
          ]
        }
      }
    }
  };
}

test('active subscription grants the mapped plan and stores lifecycle state', async () => {
  const supabase = createSupabase([baseProfile()]);

  const result = await processStripeEvent({
    supabase,
    event: subscriptionEvent(),
    env
  });

  assert.equal(result, 'updated');
  assert.equal(supabase.profiles[0].plan, 'standard');
  assert.equal(supabase.profiles[0].payment_status, 'active');
  assert.equal(supabase.profiles[0].subscription_status, 'active');
  assert.equal(supabase.profiles[0].stripe_subscription_id, 'sub_123');
  assert.equal(
    supabase.profiles[0].subscription_cancel_at_period_end,
    false
  );
  assert.match(
    supabase.profiles[0].subscription_current_period_end,
    /^2030-01-01T00:00:00\.000Z$/
  );
});

test('scheduled cancellation keeps access until Stripe ends the subscription', async () => {
  const supabase = createSupabase([baseProfile()]);

  await processStripeEvent({
    supabase,
    event: subscriptionEvent({ cancelAtPeriodEnd: true }),
    env
  });

  assert.equal(supabase.profiles[0].plan, 'standard');
  assert.equal(supabase.profiles[0].subscription_cancel_at_period_end, true);
});

test('past_due keeps the paid plan during recovery but marks payment failed', async () => {
  const supabase = createSupabase([baseProfile()]);

  await processStripeEvent({
    supabase,
    event: subscriptionEvent({
      status: 'past_due',
      priceId: 'price_premium'
    }),
    env
  });

  assert.equal(supabase.profiles[0].plan, 'premium');
  assert.equal(supabase.profiles[0].payment_status, 'failed');
});

test('unpaid or canceled subscription revokes paid entitlement', async () => {
  for (const status of ['unpaid', 'canceled']) {
    const supabase = createSupabase([
      baseProfile({ plan: 'premium', stripe_subscription_id: 'sub_123' })
    ]);

    await processStripeEvent({
      supabase,
      event: subscriptionEvent({ status, priceId: 'unknown_price' }),
      env
    });

    assert.equal(supabase.profiles[0].plan, 'free');
  }
});

test('unknown paid price fails closed instead of granting a plan', async () => {
  const supabase = createSupabase([baseProfile()]);

  await assert.rejects(
    processStripeEvent({
      supabase,
      event: subscriptionEvent({ priceId: 'price_unknown' }),
      env
    }),
    /unknown Stripe price/
  );

  assert.equal(supabase.profiles[0].plan, 'free');
  assert.equal(supabase.calls.updates.length, 0);
});

test('duplicate and stale events cannot roll billing state backward', async () => {
  const supabase = createSupabase([
    baseProfile({
      plan: 'premium',
      stripe_last_event_id: 'evt_new',
      stripe_last_event_created_at: 200
    })
  ]);

  const duplicateResult = await processStripeEvent({
    supabase,
    event: subscriptionEvent({
      id: 'evt_new',
      created: 200,
      priceId: 'price_standard'
    }),
    env
  });
  assert.equal(duplicateResult, 'duplicate');

  const staleResult = await processStripeEvent({
    supabase,
    event: subscriptionEvent({
      id: 'evt_old',
      created: 100,
      priceId: 'price_standard'
    }),
    env
  });
  assert.equal(staleResult, 'stale');
  assert.equal(supabase.profiles[0].plan, 'premium');
});

test('checkout completion records Stripe identifiers without granting entitlement', async () => {
  const supabase = createSupabase([
    baseProfile({ stripe_customer_id: null })
  ]);

  const result = await processStripeEvent({
    supabase,
    event: {
      id: 'evt_checkout',
      created: 100,
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: 'user-123',
          metadata: { userId: 'user-123', plan: 'premium' },
          customer: 'cus_new',
          subscription: 'sub_new'
        }
      }
    },
    env
  });

  assert.equal(result, 'updated');
  assert.equal(supabase.profiles[0].stripe_customer_id, 'cus_new');
  assert.equal(supabase.profiles[0].stripe_subscription_id, 'sub_new');
  assert.equal(supabase.profiles[0].plan, 'free');
});

test('invoice events update payment state only for paid profiles', async () => {
  const paidSupabase = createSupabase([
    baseProfile({ plan: 'standard' })
  ]);

  const result = await processStripeEvent({
    supabase: paidSupabase,
    event: {
      id: 'evt_invoice',
      created: 300,
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_123' } }
    },
    env
  });

  assert.equal(result, 'updated');
  assert.equal(paidSupabase.profiles[0].payment_status, 'failed');
  assert.equal(paidSupabase.profiles[0].plan, 'standard');

  const freeSupabase = createSupabase([baseProfile()]);
  const ignored = await processStripeEvent({
    supabase: freeSupabase,
    event: {
      id: 'evt_invoice_free',
      created: 300,
      type: 'invoice.paid',
      data: { object: { customer: 'cus_123' } }
    },
    env
  });

  assert.equal(ignored, 'ignored-free-profile');
  assert.equal(freeSupabase.calls.updates.length, 0);
});

test('unrelated Stripe events are acknowledged without profile changes', async () => {
  const supabase = createSupabase([baseProfile()]);

  const result = await processStripeEvent({
    supabase,
    event: {
      id: 'evt_other',
      created: 100,
      type: 'customer.updated',
      data: { object: {} }
    },
    env
  });

  assert.equal(result, 'ignored');
  assert.equal(supabase.calls.updates.length, 0);
});
