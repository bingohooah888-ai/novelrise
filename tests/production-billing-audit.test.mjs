import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REQUIRED_PRODUCTION_WEBHOOK_EVENTS,
  auditProductionBilling,
  isLegacyNovelightWebhookEndpoint
} from '../scripts/production-billing-audit-lib.mjs';

const canonicalWebhookUrl = 'https://novelrise.vercel.app/api/stripe-webhook';

function createSupabase(profiles) {
  return {
    from(table) {
      assert.equal(table, 'profiles');
      return {
        select() {
          return this;
        },
        async limit(limit) {
          assert.equal(limit, 10000);
          return {
            data: profiles.map((profile) => ({ ...profile })),
            error: null
          };
        }
      };
    }
  };
}

function createStripe({
  customers = {},
  subscriptions = {},
  endpoints = []
} = {}) {
  return {
    customers: {
      async retrieve(customerId) {
        const value = customers[customerId];
        if (value instanceof Error) throw value;
        if (!value)
          throw Object.assign(new Error('No such customer'), {
            type: 'StripeInvalidRequestError',
            code: 'resource_missing',
            param: 'customer'
          });
        return value;
      }
    },
    subscriptions: {
      async list({ customer }) {
        return { data: subscriptions[customer] || [] };
      }
    },
    webhookEndpoints: {
      async list() {
        return { data: endpoints };
      }
    }
  };
}

function canonicalEndpoint(overrides = {}) {
  return {
    id: 'we_canonical',
    url: canonicalWebhookUrl,
    status: 'enabled',
    description: 'NOVELIGHT production subscription synchronization',
    enabled_events: [...REQUIRED_PRODUCTION_WEBHOOK_EVENTS],
    ...overrides
  };
}

function paidProfile(overrides = {}) {
  return {
    id: 'user-paid',
    display_name: 'Paid Author',
    plan: 'premium',
    payment_status: 'active',
    stripe_customer_id: 'cus_paid',
    stripe_subscription_id: 'sub_paid',
    subscription_status: 'active',
    ...overrides
  };
}

function betaFreeStandard(overrides = {}) {
  return {
    id: 'user-standard',
    display_name: 'Beta Standard Author',
    plan: 'standard',
    payment_status: 'beta_free',
    stripe_customer_id: null,
    stripe_subscription_id: null,
    subscription_status: null,
    ...overrides
  };
}

test('healthy Production billing state passes with paid Premium and cardless beta Standard', async () => {
  const result = await auditProductionBilling({
    supabase: createSupabase([paidProfile(), betaFreeStandard()]),
    stripe: createStripe({
      customers: { cus_paid: { id: 'cus_paid', deleted: false } },
      subscriptions: { cus_paid: [{ id: 'sub_paid', status: 'active' }] },
      endpoints: [canonicalEndpoint()]
    }),
    canonicalWebhookUrl
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.summary.betaFreeStandardCount, 1);
  assert.equal(result.summary.canonicalWebhookCount, 1);
  assert.equal(result.summary.legacyWebhookCount, 0);
});

test('stale paid Stripe customer is an issue while stale non-paid customer is a warning', async () => {
  const result = await auditProductionBilling({
    supabase: createSupabase([
      paidProfile({ stripe_customer_id: 'cus_missing_paid' }),
      {
        id: 'user-free',
        display_name: 'Free Author',
        plan: 'free',
        payment_status: 'canceled',
        stripe_customer_id: 'cus_missing_free',
        stripe_subscription_id: null,
        subscription_status: null
      }
    ]),
    stripe: createStripe({ endpoints: [canonicalEndpoint()] }),
    canonicalWebhookUrl
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some(
      (item) => item.code === 'paid_profile_customer_missing_in_stripe'
    )
  );
  assert.ok(
    result.warnings.some(
      (item) => item.code === 'non_paid_profile_stale_customer_reference'
    )
  );
});

test('beta-free Standard with a live entitled subscription fails closed', async () => {
  const result = await auditProductionBilling({
    supabase: createSupabase([
      betaFreeStandard({
        stripe_customer_id: 'cus_live',
        stripe_subscription_id: 'sub_live',
        subscription_status: 'active'
      })
    ]),
    stripe: createStripe({
      customers: { cus_live: { id: 'cus_live', deleted: false } },
      subscriptions: { cus_live: [{ id: 'sub_live', status: 'active' }] },
      endpoints: [canonicalEndpoint()]
    }),
    canonicalWebhookUrl
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some(
      (item) => item.code === 'beta_free_standard_has_entitled_subscription'
    )
  );
});

test('free profile with a live entitled subscription fails closed', async () => {
  const result = await auditProductionBilling({
    supabase: createSupabase([
      {
        id: 'user-free',
        display_name: 'Free Author',
        plan: 'free',
        payment_status: 'canceled',
        stripe_customer_id: 'cus_live',
        stripe_subscription_id: 'sub_live',
        subscription_status: 'active'
      }
    ]),
    stripe: createStripe({
      customers: { cus_live: { id: 'cus_live', deleted: false } },
      subscriptions: { cus_live: [{ id: 'sub_live', status: 'active' }] },
      endpoints: [canonicalEndpoint()]
    }),
    canonicalWebhookUrl
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some(
      (item) => item.code === 'free_profile_has_entitled_subscription'
    )
  );
});

test('legacy Vercel webhook endpoint targeting the Production webhook path is detected', async () => {
  const legacy = {
    id: 'we_legacy',
    url: 'https://novelrise-old-deploy-ranobe1.vercel.app/api/stripe-webhook',
    status: 'enabled',
    enabled_events: [...REQUIRED_PRODUCTION_WEBHOOK_EVENTS]
  };
  assert.equal(
    isLegacyNovelightWebhookEndpoint(legacy, canonicalWebhookUrl),
    true
  );
  const result = await auditProductionBilling({
    supabase: createSupabase([]),
    stripe: createStripe({ endpoints: [canonicalEndpoint(), legacy] }),
    canonicalWebhookUrl
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some(
      (item) => item.code === 'legacy_novelight_webhook_endpoint'
    )
  );
  assert.equal(result.summary.legacyWebhookCount, 1);
});

test('unrelated webhook endpoints are ignored', () => {
  assert.equal(
    isLegacyNovelightWebhookEndpoint(
      {
        id: 'we_other',
        url: 'https://example.com/api/stripe-webhook',
        status: 'enabled',
        description: 'Other app'
      },
      canonicalWebhookUrl
    ),
    false
  );
});
