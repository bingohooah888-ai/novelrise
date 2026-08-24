import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import Stripe from 'stripe';

import { processStripeEvent } from '../api/_lib/stripe-webhook.js';

const command = process.argv[2];
const fixturePath =
  process.env.STRIPE_SANDBOX_FIXTURE || '/tmp/novelight-stripe-sandbox.json';
const secretKey = process.env.STRIPE_TEST_SECRET_KEY;
const runId = String(process.env.GITHUB_RUN_ID || Date.now());
const userId = `stripe-sandbox-e2e-${runId}`;

if (!secretKey) throw new Error('STRIPE_TEST_SECRET_KEY is required.');
if (!secretKey.startsWith('sk_test_')) {
  throw new Error('Refusing to run Stripe sandbox lifecycle with a non-test key.');
}

const stripe = new Stripe(secretKey, { maxNetworkRetries: 2 });

function loadFixture() {
  if (!existsSync(fixturePath)) return { runId };
  return JSON.parse(readFileSync(fixturePath, 'utf8'));
}

function saveFixture(fixture) {
  writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), { mode: 0o600 });
}

function currentPeriodEnd(subscription) {
  return (
    subscription.items?.data?.[0]?.current_period_end ??
    subscription.current_period_end ??
    null
  );
}

function profileSupabase(profile) {
  return {
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
          return {
            data: matches
              ? [
                  {
                    id: profile.id,
                    plan: profile.plan,
                    stripe_customer_id: profile.stripe_customer_id,
                    stripe_subscription_id: profile.stripe_subscription_id
                  }
                ]
              : [],
            error: null
          };
        }
      };
    }
  };
}

async function syncProfileFromSubscription(subscription, fixture, initialProfile) {
  const profile = {
    id: userId,
    plan: 'free',
    payment_status: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    ...initialProfile
  };

  const eventType =
    subscription.status === 'canceled'
      ? 'customer.subscription.deleted'
      : 'customer.subscription.updated';

  await processStripeEvent({
    stripe,
    supabase: profileSupabase(profile),
    event: {
      id: `evt_novelight_sandbox_${runId}_${eventType}`,
      type: eventType,
      data: { object: subscription }
    },
    env: {
      STRIPE_STANDARD_PRICE_ID: fixture.priceId,
      STRIPE_PREMIUM_PRICE_ID: 'price_unused_sandbox_premium'
    }
  });

  return profile;
}

async function waitForClockReady(clockId) {
  for (let attempt = 1; attempt <= 90; attempt += 1) {
    const clock = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (clock.status === 'ready') return clock;
    if (clock.status !== 'advancing') {
      throw new Error(`Unexpected Stripe test clock status: ${clock.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Stripe test clock did not become ready in time.');
}

async function waitForSubscriptionState(
  subscriptionId,
  predicate,
  description,
  attempts = 30
) {
  let subscription = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
    if (predicate(subscription)) return subscription;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `Stripe subscription did not reach ${description}. ` +
      `status=${subscription?.status ?? 'unknown'} ` +
      `cancel_at_period_end=${subscription?.cancel_at_period_end ?? 'unknown'} ` +
      `cancel_at=${subscription?.cancel_at ?? 'unknown'}`
  );
}

async function setup() {
  const frozenTime = Math.floor(Date.now() / 1000);
  const fixture = { runId, createdAt: new Date().toISOString() };
  saveFixture(fixture);

  const clock = await stripe.testHelpers.testClocks.create({
    frozen_time: frozenTime,
    name: `NOVELIGHT billing lifecycle ${runId}`
  });
  fixture.testClockId = clock.id;
  saveFixture(fixture);

  const product = await stripe.products.create({
    name: `NOVELIGHT Standard sandbox E2E ${runId}`,
    metadata: { novelight_internal_e2e: 'true', run_id: runId }
  });
  fixture.productId = product.id;
  saveFixture(fixture);

  const price = await stripe.prices.create({
    product: product.id,
    currency: 'jpy',
    unit_amount: 980,
    recurring: { interval: 'month' },
    metadata: { novelight_internal_e2e: 'true', run_id: runId }
  });
  fixture.priceId = price.id;
  saveFixture(fixture);

  const customer = await stripe.customers.create({
    email: `novelight-billing-e2e-${runId}@example.com`,
    test_clock: clock.id,
    metadata: { novelight_internal_e2e: 'true', userId, run_id: runId }
  });
  fixture.customerId = customer.id;
  saveFixture(fixture);

  const paymentMethod = await stripe.paymentMethods.attach('pm_card_visa', {
    customer: customer.id
  });
  fixture.paymentMethodId = paymentMethod.id;
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: paymentMethod.id }
  });

  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: price.id }],
    payment_behavior: 'error_if_incomplete',
    metadata: { novelight_internal_e2e: 'true', userId, run_id: runId }
  });
  assert.equal(subscription.status, 'active');
  fixture.subscriptionId = subscription.id;
  fixture.initialPeriodEnd = currentPeriodEnd(subscription);
  assert.ok(fixture.initialPeriodEnd, 'subscription current period end is required');
  saveFixture(fixture);

  const configuration = await stripe.billingPortal.configurations.create({
    business_profile: {
      headline: 'NOVELIGHT billing lifecycle sandbox verification'
    },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: 'at_period_end'
      },
      subscription_update: {
        enabled: false,
        default_allowed_updates: []
      }
    },
    metadata: { novelight_internal_e2e: 'true', run_id: runId }
  });
  fixture.portalConfigurationId = configuration.id;
  saveFixture(fixture);

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customer.id,
    configuration: configuration.id,
    locale: 'en',
    return_url: 'https://example.com/novelight-billing-e2e-return',
    flow_data: {
      type: 'subscription_cancel',
      subscription_cancel: { subscription: subscription.id },
      after_completion: {
        type: 'redirect',
        redirect: {
          return_url: 'https://example.com/novelight-billing-e2e-canceled'
        }
      }
    }
  });
  assert.match(portalSession.url, /^https:\/\/billing\.stripe\.com\//);
  fixture.portalUrl = portalSession.url;
  saveFixture(fixture);

  const profile = await syncProfileFromSubscription(subscription, fixture);
  assert.equal(profile.plan, 'standard');
  assert.equal(profile.payment_status, 'active');
  assert.equal(profile.stripe_customer_id, customer.id);
  assert.equal(profile.stripe_subscription_id, subscription.id);
  assert.equal(profile.subscription_cancel_at_period_end, false);

  console.log('Stripe sandbox billing lifecycle fixture is ready.');
}

async function verifyScheduledCancellation() {
  const fixture = loadFixture();
  assert.ok(fixture.subscriptionId, 'subscription fixture is missing');
  const subscription = await waitForSubscriptionState(
    fixture.subscriptionId,
    (candidate) =>
      candidate.status === 'active' && candidate.cancel_at_period_end === true,
    'active cancellation-at-period-end state'
  );

  const profile = await syncProfileFromSubscription(subscription, fixture, {
    plan: 'standard',
    payment_status: 'active',
    stripe_customer_id: fixture.customerId,
    stripe_subscription_id: fixture.subscriptionId
  });

  assert.equal(profile.plan, 'standard');
  assert.equal(profile.payment_status, 'active');
  assert.equal(profile.subscription_status, 'active');
  assert.equal(profile.subscription_cancel_at_period_end, true);
  assert.ok(profile.subscription_current_period_end);

  fixture.scheduledCancellationVerifiedAt = new Date().toISOString();
  saveFixture(fixture);
  console.log('Portal cancellation is scheduled and Standard access is retained.');
}

async function advancePastPeriodEnd() {
  const fixture = loadFixture();
  const subscription = await stripe.subscriptions.retrieve(fixture.subscriptionId);
  const periodEnd = currentPeriodEnd(subscription);
  assert.ok(periodEnd, 'subscription current period end is required');

  await stripe.testHelpers.testClocks.advance(fixture.testClockId, {
    frozen_time: periodEnd + 60
  });
  await waitForClockReady(fixture.testClockId);

  const endedSubscription = await stripe.subscriptions.retrieve(
    fixture.subscriptionId
  );
  assert.equal(endedSubscription.status, 'canceled');

  const profile = await syncProfileFromSubscription(endedSubscription, fixture, {
    plan: 'standard',
    payment_status: 'active',
    stripe_customer_id: fixture.customerId,
    stripe_subscription_id: fixture.subscriptionId
  });

  assert.equal(profile.plan, 'free');
  assert.equal(profile.payment_status, 'canceled');
  assert.equal(profile.subscription_status, 'canceled');
  assert.equal(profile.subscription_cancel_at_period_end, true);

  fixture.periodEndVerifiedAt = new Date().toISOString();
  saveFixture(fixture);
  console.log('Subscription ended and NOVELIGHT entitlement returned to Free.');
}

async function cleanup() {
  const fixture = loadFixture();
  const cleanupErrors = [];

  async function attempt(label, operation) {
    try {
      await operation();
    } catch (error) {
      if (/No such|resource_missing|not found/i.test(String(error?.message || error))) {
        return;
      }
      cleanupErrors.push(`${label}: ${error?.message || error}`);
    }
  }

  if (fixture.testClockId) {
    await attempt('delete test clock', () =>
      stripe.testHelpers.testClocks.del(fixture.testClockId)
    );
  }
  if (fixture.portalConfigurationId) {
    await attempt('deactivate portal configuration', () =>
      stripe.billingPortal.configurations.update(
        fixture.portalConfigurationId,
        { active: false }
      )
    );
  }
  if (fixture.priceId) {
    await attempt('deactivate price', () =>
      stripe.prices.update(fixture.priceId, { active: false })
    );
  }
  if (fixture.productId) {
    await attempt('deactivate product', () =>
      stripe.products.update(fixture.productId, { active: false })
    );
  }

  if (cleanupErrors.length) {
    throw new Error(`Stripe sandbox cleanup failed: ${cleanupErrors.join('; ')}`);
  }

  console.log('Stripe sandbox billing lifecycle fixture cleaned.');
}

if (command === 'setup') await setup();
else if (command === 'verify-scheduled') await verifyScheduledCancellation();
else if (command === 'advance-and-verify') await advancePastPeriodEnd();
else if (command === 'cleanup') await cleanup();
else {
  throw new Error(
    'Use setup, verify-scheduled, advance-and-verify, or cleanup.'
  );
}
