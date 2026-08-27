import assert from 'node:assert/strict';
import test from 'node:test';

import { repairMissingProductionCustomer } from '../scripts/production-billing-repair-lib.mjs';

function createSupabase(profiles) {
  const calls = { updates: [] };

  return {
    calls,
    client: {
      from(table) {
        assert.equal(table, 'profiles');
        let operation = 'select';
        let changes = null;
        const filters = [];

        const builder = {
          select() {
            return builder;
          },
          update(nextChanges) {
            operation = 'update';
            changes = nextChanges;
            return builder;
          },
          eq(column, value) {
            filters.push([column, value]);
            return builder;
          },
          async limit(limit) {
            assert.ok(limit === 1 || limit === 2);

            const matches = profiles.filter((profile) =>
              filters.every(([column, value]) => profile[column] === value)
            );

            if (operation === 'select') {
              return { data: matches.slice(0, limit), error: null };
            }

            calls.updates.push({ changes, filters: [...filters] });
            const updated = matches.slice(0, limit).map((profile) => {
              Object.assign(profile, changes);
              return { ...profile };
            });
            return { data: updated, error: null };
          }
        };

        return builder;
      }
    }
  };
}

function paidProfile(overrides = {}) {
  return {
    id: 'user-123',
    display_name: 'テスト作者',
    plan: 'standard',
    payment_status: 'active',
    stripe_customer_id: 'cus_stale',
    stripe_subscription_id: 'sub_stale',
    stripe_subscription_created_at: 123,
    subscription_status: 'active',
    subscription_cancel_at_period_end: false,
    subscription_current_period_end: '2026-09-27T00:00:00Z',
    ...overrides
  };
}

const silentLogger = {
  log() {},
  warn() {}
};

test('repairs exactly one active paid profile when Stripe confirms its customer is missing', async () => {
  const profile = paidProfile();
  const supabase = createSupabase([profile]);
  const stripe = {
    customers: {
      async retrieve(customerId) {
        assert.equal(customerId, 'cus_stale');
        throw Object.assign(new Error('No such customer'), {
          type: 'StripeInvalidRequestError',
          code: 'resource_missing',
          param: 'customer'
        });
      }
    }
  };

  const result = await repairMissingProductionCustomer({
    supabase: supabase.client,
    stripe,
    targetDisplayName: 'テスト作者',
    logger: silentLogger
  });

  assert.deepEqual(result, {
    displayName: 'テスト作者',
    plan: 'free',
    paymentStatus: 'canceled',
    verified: true
  });
  assert.equal(supabase.calls.updates.length, 1);
  assert.equal(profile.plan, 'free');
  assert.equal(profile.payment_status, 'canceled');
  assert.equal(profile.stripe_customer_id, null);
  assert.equal(profile.stripe_subscription_id, null);
  assert.equal(profile.stripe_subscription_created_at, null);
  assert.equal(profile.subscription_status, null);
  assert.equal(profile.subscription_cancel_at_period_end, false);
  assert.equal(profile.subscription_current_period_end, null);
});

test('fails closed when the Stripe customer still exists', async () => {
  const supabase = createSupabase([paidProfile()]);
  const stripe = {
    customers: {
      async retrieve() {
        return { id: 'cus_live', deleted: false };
      }
    }
  };

  await assert.rejects(
    repairMissingProductionCustomer({
      supabase: supabase.client,
      stripe,
      targetDisplayName: 'テスト作者',
      logger: silentLogger
    }),
    /Stripe customer still exists/
  );
  assert.equal(supabase.calls.updates.length, 0);
});

test('fails closed when display_name is not unique', async () => {
  const supabase = createSupabase([
    paidProfile({ id: 'user-1' }),
    paidProfile({ id: 'user-2' })
  ]);
  let stripeCalled = false;
  const stripe = {
    customers: {
      async retrieve() {
        stripeCalled = true;
        return { id: 'cus_live', deleted: false };
      }
    }
  };

  await assert.rejects(
    repairMissingProductionCustomer({
      supabase: supabase.client,
      stripe,
      targetDisplayName: 'テスト作者',
      logger: silentLogger
    }),
    /expected exactly 1 profile/
  );
  assert.equal(stripeCalled, false);
  assert.equal(supabase.calls.updates.length, 0);
});

test('fails closed when the target is not an active paid profile', async () => {
  const supabase = createSupabase([
    paidProfile({
      plan: 'free',
      payment_status: 'canceled',
      stripe_customer_id: null
    })
  ]);
  const stripe = {
    customers: {
      async retrieve() {
        throw new Error('should not be called');
      }
    }
  };

  await assert.rejects(
    repairMissingProductionCustomer({
      supabase: supabase.client,
      stripe,
      targetDisplayName: 'テスト作者',
      logger: silentLogger
    }),
    /not a paid plan/
  );
  assert.equal(supabase.calls.updates.length, 0);
});
