import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const EXPECTED_SUPABASE_URL = 'https://fiepaguycecrredwrcwx.supabase.co';
const EXPECTED_APP_URL = 'https://novelrise.vercel.app';
const runId = String(process.env.GITHUB_RUN_ID || Date.now());
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const stripeSecretKey = process.env.STRIPE_LIVE_SECRET_KEY;
const premiumPriceId = process.env.STRIPE_PREMIUM_PRICE_ID;
const appUrl = process.env.NOVELIGHT_APP_URL;

function fail(message) {
  throw new Error(message);
}

if (supabaseUrl !== EXPECTED_SUPABASE_URL) fail('Refusing non-canonical Production Supabase target.');
if (!supabaseSecretKey) fail('SUPABASE_SECRET_KEY is required.');
if (!stripeSecretKey?.startsWith('sk_live_')) fail('A Stripe live secret key is required.');
if (!premiumPriceId?.startsWith('price_')) fail('STRIPE_PREMIUM_PRICE_ID is required.');
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
  email: `novelight-prod-beta-billing-${runId}-${randomBytes(4).toString('hex')}@example.com`
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
        display_name: `NOVELIGHT Production Beta Billing ${runId}`,
        internal_e2e: true,
        production_beta_billing_control: true
      }
    }),
    'create Production beta billing control user'
  );
  fixture.userId = data.user.id;

  await waitFor('Production profile creation', async () => {
    const result = await admin
      .from('profiles')
      .select('id, plan, payment_status')
      .eq('id', fixture.userId)
      .maybeSingle();
    assertNoError(result, 'read Production beta billing profile');
    return { ok: Boolean(result.data?.id), value: result.data ?? null };
  }, { attempts: 20, delayMs: 500 });

  assertNoError(
    await admin.from('founding_author_exclusions').upsert(
      { user_id: fixture.userId, reason: 'automated Production beta billing control test' },
      { onConflict: 'user_id' }
    ),
    'exclude Production beta billing user from Founding Authors'
  );
}

async function signIn() {
  const auth = assertNoError(
    await authClient.auth.signInWithPassword({
      email: fixture.email,
      password: fixture.password
    }),
    'sign in Production beta billing user'
  );
  const accessToken = auth.session?.access_token;
  if (!accessToken) fail('Production beta billing user did not receive an access token.');
  return accessToken;
}

async function activateCardlessStandard(accessToken) {
  const response = await fetch(`${appUrl}/api/activate-beta-standard`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const body = await response.json().catch(() => null);
  if (
    response.status !== 200 ||
    body?.plan !== 'standard' ||
    body?.paymentStatus !== 'beta_free' ||
    body?.mode !== 'beta_free'
  ) {
    fail(`Cardless Standard activation failed: HTTP ${response.status}`);
  }

  await waitFor('Cardless Standard entitlement reflection', async () => {
    const result = await admin
      .from('profiles')
      .select('plan, payment_status, stripe_customer_id, stripe_subscription_id')
      .eq('id', fixture.userId)
      .maybeSingle();
    assertNoError(result, 'read cardless Standard profile');
    return {
      ok:
        result.data?.plan === 'standard' &&
        result.data?.payment_status === 'beta_free' &&
        !result.data?.stripe_customer_id &&
        !result.data?.stripe_subscription_id,
      value: result.data ?? null
    };
  });
}

async function verifyPremiumCheckoutWithoutCharge(accessToken) {
  const response = await fetch(`${appUrl}/api/create-checkout-session`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ plan: 'premium' })
  });
  const body = await response.json().catch(() => null);
  if (response.status !== 200 || body?.mode !== 'checkout' || !body?.url) {
    fail(`Premium checkout API canary failed: HTTP ${response.status}, mode=${body?.mode ?? 'missing'}`);
  }

  const sessionId = body.url.match(/cs_live_[A-Za-z0-9_]+/)?.[0];
  if (!sessionId) fail('Premium checkout API did not return a live Checkout Session URL.');
  fixture.checkoutSessionId = sessionId;

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items']
  });
  if (!session.livemode || session.mode !== 'subscription' || session.payment_status === 'paid') {
    fail('Premium checkout canary was not a live unpaid subscription Checkout Session.');
  }
  if (session.client_reference_id !== fixture.userId) {
    fail('Premium checkout canary session references the wrong user.');
  }
  const prices = (session.line_items?.data || []).map((item) =>
    typeof item.price === 'string' ? item.price : item.price?.id
  );
  if (!prices.includes(premiumPriceId)) {
    fail('Premium checkout canary did not use the beta 480 JPY price.');
  }
  if (session.status === 'open') {
    await stripe.checkout.sessions.expire(sessionId);
  }
}

async function createTrialPremiumSubscription() {
  const customer = await stripe.customers.create({
    email: fixture.email,
    metadata: {
      userId: fixture.userId,
      novelightControlTest: 'true',
      githubRunId: runId
    }
  });
  fixture.customerId = customer.id;

  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: premiumPriceId }],
    trial_period_days: 1,
    trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
    metadata: {
      userId: fixture.userId,
      plan: 'premium',
      novelightControlTest: 'true',
      githubRunId: runId
    }
  });
  fixture.subscriptionId = subscription.id;
  if (subscription.status !== 'trialing') {
    fail(`Expected trialing Premium subscription, got ${subscription.status}.`);
  }

  await waitFor('Stripe -> Production Premium entitlement reflection', async () => {
    const result = await admin
      .from('profiles')
      .select('plan, payment_status, stripe_customer_id, stripe_subscription_id, subscription_status')
      .eq('id', fixture.userId)
      .maybeSingle();
    assertNoError(result, 'read Premium webhook reflection');
    const row = result.data ?? null;
    return {
      ok:
        row?.plan === 'premium' &&
        row?.payment_status === 'active' &&
        row?.stripe_customer_id === fixture.customerId &&
        row?.stripe_subscription_id === fixture.subscriptionId &&
        row?.subscription_status === 'trialing',
      value: row
    };
  });
}

async function cancelAndVerifyBetaStandard() {
  await stripe.subscriptions.cancel(fixture.subscriptionId, {
    invoice_now: false,
    prorate: false
  });

  await waitFor('Stripe cancellation -> beta Standard reflection', async () => {
    const result = await admin
      .from('profiles')
      .select('plan, payment_status, stripe_customer_id, stripe_subscription_id, subscription_status')
      .eq('id', fixture.userId)
      .maybeSingle();
    assertNoError(result, 'read beta Standard cancellation reflection');
    const row = result.data ?? null;
    return {
      ok:
        row?.plan === 'standard' &&
        row?.payment_status === 'beta_free' &&
        row?.stripe_customer_id === fixture.customerId &&
        row?.stripe_subscription_id === fixture.subscriptionId &&
        row?.subscription_status === 'canceled',
      value: row
    };
  });
}

async function verifyNoCharge() {
  if (!fixture.customerId) return;
  const charges = await stripe.charges.list({ customer: fixture.customerId, limit: 10 });
  if ((charges.data || []).some((charge) => charge.amount > 0 || charge.amount_captured > 0)) {
    fail('A live Stripe charge was unexpectedly created during the beta billing control.');
  }
  const invoices = await stripe.invoices.list({ customer: fixture.customerId, limit: 10 });
  if ((invoices.data || []).some((invoice) => (invoice.amount_paid || 0) > 0)) {
    fail('A live Stripe invoice was unexpectedly paid during the beta billing control.');
  }
}

async function cleanup() {
  const errors = [];
  if (fixture.checkoutSessionId) {
    try {
      const checkout = await stripe.checkout.sessions.retrieve(fixture.checkoutSessionId);
      if (checkout.status === 'open') await stripe.checkout.sessions.expire(fixture.checkoutSessionId);
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
      assertNoError(await admin.from('subscription_event_log').delete().eq('user_id', fixture.userId), 'cleanup subscription_event_log');
      assertNoError(await admin.from('founding_author_exclusion_audit').delete().eq('author_id', fixture.userId), 'cleanup founding_author_exclusion_audit');
      assertNoError(await admin.from('founding_author_exclusions').delete().eq('user_id', fixture.userId), 'cleanup founding_author_exclusions');
      assertNoError(await admin.from('billing_checkout_attempts').delete().eq('user_id', fixture.userId), 'cleanup billing_checkout_attempts');
      assertNoError(await admin.from('profiles').delete().eq('id', fixture.userId), 'cleanup profile');
      const result = await admin.auth.admin.deleteUser(fixture.userId);
      if (result.error && !/not found/i.test(result.error.message || '')) throw new Error(result.error.message);
    } catch (error) {
      errors.push(`delete Production fixture: ${error.message}`);
    }
  }
  if (errors.length) fail(`Cleanup failed: ${errors.join('; ')}`);
}

let mainError = null;
try {
  console.log('Starting controlled Production beta billing proof (no live charge path).');
  await createEphemeralUser();
  const accessToken = await signIn();
  await activateCardlessStandard(accessToken);
  await verifyPremiumCheckoutWithoutCharge(accessToken);
  await verifyNoCharge();
  await createTrialPremiumSubscription();
  await verifyNoCharge();
  await cancelAndVerifyBetaStandard();
  await verifyNoCharge();
  console.log('PASS: cardless Standard, Premium 480 checkout, webhook entitlement, and cancellation fallback were proven without a live charge.');
} catch (error) {
  mainError = error;
  console.error(`Beta billing control failed: ${error.message}`);
} finally {
  try {
    await cleanup();
    console.log('Ephemeral Stripe/Supabase beta billing control data cleaned.');
  } catch (cleanupError) {
    if (mainError) console.error(`Cleanup also failed: ${cleanupError.message}`);
    else mainError = cleanupError;
  }
}

if (mainError) throw mainError;
