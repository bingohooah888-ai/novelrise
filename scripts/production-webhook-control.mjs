import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const EXPECTED_SUPABASE_URL = 'https://fiepaguycecrredwrcwx.supabase.co';
const EXPECTED_APP_URL = 'https://novelrise.vercel.app';
const runId = String(process.env.GITHUB_RUN_ID || Date.now());
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const stripeSecretKey = process.env.STRIPE_LIVE_SECRET_KEY;
const standardPriceId = process.env.STRIPE_STANDARD_PRICE_ID;
const appUrl = process.env.NOVELIGHT_APP_URL;

function fail(message) {
  throw new Error(message);
}

if (supabaseUrl !== EXPECTED_SUPABASE_URL) fail('Refusing non-canonical Production Supabase target.');
if (!supabaseSecretKey) fail('SUPABASE_SECRET_KEY is required.');
if (!stripeSecretKey?.startsWith('sk_live_')) fail('A Stripe live secret key is required.');
if (!standardPriceId?.startsWith('price_')) fail('STRIPE_STANDARD_PRICE_ID is required.');
if (appUrl !== EXPECTED_APP_URL) fail('Refusing non-canonical Production app URL.');

const admin = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const authClient = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const stripe = new Stripe(stripeSecretKey);

const fixture = {
  userId: null,
  customerId: null,
  subscriptionId: null,
  checkoutSessionId: null,
  password: `Nl!${randomBytes(24).toString('base64url')}9a`,
  email: `novelight-prod-webhook-${runId}-${randomBytes(4).toString('hex')}@example.com`
};

function assertNoError(result, label) {
  if (result?.error) fail(`${label}: ${result.error.message}`);
  return result?.data;
}

async function waitFor(label, probe, { attempts = 36, delayMs = 5000 } = {}) {
  let lastValue;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastValue = await probe();
    if (lastValue?.ok) return lastValue.value;
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  fail(`${label} did not converge. Last observation: ${JSON.stringify(lastValue?.value ?? null)}`);
}

async function createEphemeralUser() {
  const data = assertNoError(
    await admin.auth.admin.createUser({
      email: fixture.email,
      password: fixture.password,
      email_confirm: true,
      user_metadata: {
        display_name: `NOVELIGHT Production Webhook Control ${runId}`,
        internal_e2e: true,
        production_webhook_control: true
      }
    }),
    'create Production webhook control user'
  );
  fixture.userId = data.user.id;

  await waitFor('Production profile creation', async () => {
    const result = await admin
      .from('profiles')
      .select('id, plan, payment_status, stripe_customer_id, stripe_subscription_id, subscription_status')
      .eq('id', fixture.userId)
      .maybeSingle();
    assertNoError(result, 'read Production webhook control profile');
    return { ok: Boolean(result.data?.id), value: result.data ?? null };
  }, { attempts: 20, delayMs: 500 });

  assertNoError(
    await admin.from('founding_author_exclusions').upsert(
      { user_id: fixture.userId, reason: 'automated Production webhook control test' },
      { onConflict: 'user_id' }
    ),
    'exclude Production webhook control user from Founding Authors'
  );
}

async function verifyCheckoutApiWithoutCharge() {
  const auth = assertNoError(
    await authClient.auth.signInWithPassword({
      email: fixture.email,
      password: fixture.password
    }),
    'sign in Production checkout canary user'
  );
  const accessToken = auth.session?.access_token;
  if (!accessToken) fail('Production checkout canary did not receive an access token.');

  const response = await fetch(`${appUrl}/api/create-checkout-session`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ plan: 'standard' })
  });
  const body = await response.json().catch(() => null);

  if (response.status !== 200 || body?.mode !== 'checkout' || !body?.url) {
    fail(
      `Production checkout API canary failed: HTTP ${response.status}, mode=${body?.mode ?? 'missing'}`
    );
  }

  const checkoutUrl = new URL(body.url);
  if (checkoutUrl.hostname !== 'checkout.stripe.com') {
    fail(`Production checkout API returned unexpected host ${checkoutUrl.hostname}`);
  }

  const sessionId = body.url.match(/cs_live_[A-Za-z0-9_]+/)?.[0];
  if (!sessionId) fail('Production checkout API did not return a live Checkout Session URL.');
  fixture.checkoutSessionId = sessionId;

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items']
  });
  if (!session.livemode || session.mode !== 'subscription') {
    fail('Production checkout canary returned a non-live or non-subscription session.');
  }
  if (session.client_reference_id !== fixture.userId) {
    fail('Production checkout canary session references the wrong user.');
  }
  if (session.payment_status === 'paid') {
    fail('Production checkout canary unexpectedly created a paid session.');
  }

  const prices = (session.line_items?.data || []).map((item) =>
    typeof item.price === 'string' ? item.price : item.price?.id
  );
  if (!prices.includes(standardPriceId)) {
    fail('Production checkout canary did not use the expected Standard price.');
  }

  if (typeof session.customer === 'string') {
    const customer = await stripe.customers.retrieve(session.customer);
    if (customer.deleted || customer.email !== fixture.email) {
      fail('Production checkout canary created an unexpected Stripe customer.');
    }
    fixture.customerId = customer.id;
  }

  if (session.status === 'open') {
    await stripe.checkout.sessions.expire(sessionId);
  }

  console.log('PASS: Production checkout API created a live unpaid Checkout Session and it was expired without payment.');
}

async function createTrialSubscription() {
  let customer;
  if (fixture.customerId) {
    customer = await stripe.customers.update(fixture.customerId, {
      metadata: {
        userId: fixture.userId,
        novelightControlTest: 'true',
        githubRunId: runId
      }
    });
  } else {
    customer = await stripe.customers.create({
      email: fixture.email,
      metadata: {
        userId: fixture.userId,
        novelightControlTest: 'true',
        githubRunId: runId
      }
    });
    fixture.customerId = customer.id;
  }

  if (customer.invoice_settings?.default_payment_method) {
    fail('Control customer unexpectedly has a default payment method.');
  }

  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: standardPriceId }],
    trial_period_days: 1,
    trial_settings: {
      end_behavior: { missing_payment_method: 'cancel' }
    },
    metadata: {
      userId: fixture.userId,
      novelightControlTest: 'true',
      githubRunId: runId
    }
  });
  fixture.subscriptionId = subscription.id;

  if (subscription.status !== 'trialing') {
    fail(`Expected trialing subscription, got ${subscription.status}.`);
  }
}

async function verifyStandardReflection() {
  await waitFor('Stripe -> Production Standard entitlement reflection', async () => {
    const result = await admin
      .from('profiles')
      .select('plan, payment_status, stripe_customer_id, stripe_subscription_id, subscription_status')
      .eq('id', fixture.userId)
      .maybeSingle();
    assertNoError(result, 'read Standard webhook reflection');
    const row = result.data ?? null;
    return {
      ok:
        row?.plan === 'standard' &&
        row?.payment_status === 'active' &&
        row?.stripe_customer_id === fixture.customerId &&
        row?.stripe_subscription_id === fixture.subscriptionId &&
        row?.subscription_status === 'trialing',
      value: row
    };
  });

  await waitFor('Production webhook audit event creation', async () => {
    const result = await admin
      .from('subscription_event_log')
      .select('stripe_event_id, event_type, plan_snapshot, subscription_status, payment_status')
      .eq('user_id', fixture.userId)
      .eq('event_type', 'customer.subscription.created')
      .limit(5);
    assertNoError(result, 'read Production webhook audit event');
    return { ok: (result.data || []).length >= 1, value: result.data || [] };
  });
}

async function verifyNoCharge() {
  if (!fixture.customerId) return;

  const charges = await stripe.charges.list({ customer: fixture.customerId, limit: 10 });
  if ((charges.data || []).some((charge) => charge.amount > 0 || charge.amount_captured > 0)) {
    fail('A live Stripe charge was unexpectedly created during the control test.');
  }

  const invoices = await stripe.invoices.list({ customer: fixture.customerId, limit: 10 });
  if ((invoices.data || []).some((invoice) => (invoice.amount_paid || 0) > 0)) {
    fail('A live Stripe invoice was unexpectedly paid during the control test.');
  }
}

async function cancelAndVerifyFreeReflection() {
  await stripe.subscriptions.cancel(fixture.subscriptionId, { invoice_now: false, prorate: false });

  await waitFor('Stripe -> Production cancellation reflection', async () => {
    const result = await admin
      .from('profiles')
      .select('plan, payment_status, stripe_customer_id, stripe_subscription_id, subscription_status')
      .eq('id', fixture.userId)
      .maybeSingle();
    assertNoError(result, 'read canceled webhook reflection');
    const row = result.data ?? null;
    return {
      ok:
        row?.plan === 'free' &&
        row?.payment_status === 'canceled' &&
        row?.stripe_customer_id === fixture.customerId &&
        row?.stripe_subscription_id === fixture.subscriptionId &&
        row?.subscription_status === 'canceled',
      value: row
    };
  });

  await waitFor('Production cancellation audit event creation', async () => {
    const result = await admin
      .from('subscription_event_log')
      .select('stripe_event_id, event_type, plan_snapshot, subscription_status, payment_status')
      .eq('user_id', fixture.userId)
      .eq('event_type', 'customer.subscription.deleted')
      .limit(5);
    assertNoError(result, 'read Production cancellation audit event');
    return { ok: (result.data || []).length >= 1, value: result.data || [] };
  });
}

async function cleanup() {
  const errors = [];

  if (fixture.checkoutSessionId) {
    try {
      const checkout = await stripe.checkout.sessions.retrieve(fixture.checkoutSessionId);
      if (checkout.status === 'open') {
        await stripe.checkout.sessions.expire(fixture.checkoutSessionId);
      }
    } catch (error) {
      if (error?.code !== 'resource_missing') errors.push(`expire Checkout Session: ${error.message}`);
    }
  }

  if (fixture.subscriptionId) {
    try {
      const subscription = await stripe.subscriptions.retrieve(fixture.subscriptionId);
      if (subscription.status !== 'canceled') {
        await stripe.subscriptions.cancel(fixture.subscriptionId, { invoice_now: false, prorate: false });
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    } catch (error) {
      if (error?.code !== 'resource_missing') errors.push(`cancel subscription: ${error.message}`);
    }
  }

  if (fixture.customerId) {
    try {
      await stripe.customers.del(fixture.customerId);
    } catch (error) {
      if (error?.code !== 'resource_missing') errors.push(`delete customer: ${error.message}`);
    }
  }

  if (fixture.userId) {
    try {
      assertNoError(
        await admin.from('subscription_event_log').delete().eq('user_id', fixture.userId),
        'cleanup subscription_event_log'
      );
      assertNoError(
        await admin.from('founding_author_exclusion_audit').delete().eq('author_id', fixture.userId),
        'cleanup founding_author_exclusion_audit'
      );
      assertNoError(
        await admin.from('founding_author_exclusions').delete().eq('user_id', fixture.userId),
        'cleanup founding_author_exclusions'
      );
      assertNoError(
        await admin.from('profiles').delete().eq('id', fixture.userId),
        'cleanup profile'
      );
      const result = await admin.auth.admin.deleteUser(fixture.userId);
      if (result.error && !/not found/i.test(result.error.message || '')) {
        throw new Error(result.error.message);
      }
    } catch (error) {
      errors.push(`delete Production fixture: ${error.message}`);
    }
  }

  if (errors.length) fail(`Cleanup failed: ${errors.join('; ')}`);
}

let mainError = null;
try {
  console.log('Starting controlled Production checkout + Stripe live webhook proof (no live charge path).');
  await createEphemeralUser();
  await verifyCheckoutApiWithoutCharge();
  await verifyNoCharge();
  await createTrialSubscription();
  await verifyStandardReflection();
  await verifyNoCharge();
  await cancelAndVerifyFreeReflection();
  await verifyNoCharge();
  console.log('PASS: Production checkout API and external Stripe live webhook delivery were proven without a live charge.');
} catch (error) {
  mainError = error;
  console.error(`Control test failed: ${error.message}`);
} finally {
  try {
    await cleanup();
    console.log('Ephemeral Stripe/Supabase control-test data cleaned.');
  } catch (cleanupError) {
    if (mainError) {
      console.error(`Cleanup also failed: ${cleanupError.message}`);
    } else {
      mainError = cleanupError;
    }
  }
}

if (mainError) throw mainError;
