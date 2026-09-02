const ACCESS_STATUSES = new Set(['active', 'trialing', 'past_due']);
const NON_RENEWABLE_STATUSES = new Set([
  'canceled',
  'unpaid',
  'incomplete_expired'
]);

function stripeId(value) {
  if (typeof value === 'string') {
    return value;
  }

  return value?.id ?? null;
}

function planForPriceId(priceId, env) {
  if (priceId && priceId === env.STRIPE_STANDARD_PRICE_ID) {
    return 'standard';
  }

  if (
    priceId &&
    (priceId === env.STRIPE_PREMIUM_PRICE_ID ||
      priceId === env.STRIPE_PREMIUM_LEGACY_PRICE_ID)
  ) {
    return 'premium';
  }

  return null;
}

function betaStandardIsFree(env) {
  return env.NOVELIGHT_BETA_STANDARD_FREE === 'true';
}

function fallbackPlan(env) {
  return betaStandardIsFree(env) ? 'standard' : 'free';
}

function fallbackPaymentStatus(env, status) {
  return betaStandardIsFree(env)
    ? 'beta_free'
    : paymentStatusForSubscription(status);
}

function paymentStatusForSubscription(status) {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
    case 'incomplete_expired':
      return 'failed';
    case 'canceled':
      return 'canceled';
    case 'incomplete':
      return 'pending';
    case 'paused':
      return 'paused';
    default:
      return 'unknown';
  }
}

function currentPeriodEndEpoch(subscription) {
  const epochSeconds = subscription.items?.data?.[0]?.current_period_end;

  return Number.isInteger(epochSeconds) ? epochSeconds : null;
}

function currentPeriodEnd(subscription) {
  const epochSeconds = currentPeriodEndEpoch(subscription);

  return Number.isInteger(epochSeconds)
    ? new Date(epochSeconds * 1000).toISOString()
    : null;
}

function cancellationScheduledAtCurrentPeriodEnd(subscription) {
  const periodEnd = currentPeriodEndEpoch(subscription);

  return (
    subscription.cancel_at_period_end === true ||
    (Number.isInteger(subscription.cancel_at) &&
      Number.isInteger(periodEnd) &&
      subscription.cancel_at === periodEnd)
  );
}

function compareSubscriptions(a, b) {
  const accessDifference =
    Number(ACCESS_STATUSES.has(b.status)) -
    Number(ACCESS_STATUSES.has(a.status));

  if (accessDifference !== 0) {
    return accessDifference;
  }

  const createdDifference = (b.created ?? 0) - (a.created ?? 0);

  if (createdDifference !== 0) {
    return createdDifference;
  }

  return String(b.id).localeCompare(String(a.id));
}

function chooseCanonicalSubscription(subscriptions) {
  return [...subscriptions].sort(compareSubscriptions)[0] ?? null;
}

async function findProfile(supabase, { userId, customerId }) {
  let query = supabase
    .from('profiles')
    .select('id, plan, stripe_customer_id, stripe_subscription_id');

  if (userId) {
    query = query.eq('id', userId);
  } else if (customerId) {
    query = query.eq('stripe_customer_id', customerId);
  } else {
    throw new Error('No profile identifier was supplied');
  }

  const { data, error } = await query.limit(2);

  if (error) {
    throw new Error(`Profile lookup failed: ${error.message}`);
  }

  if (!data || data.length === 0) {
    throw new Error('Billing profile was not found');
  }

  if (data.length > 1) {
    throw new Error('Billing profile lookup was ambiguous');
  }

  return data[0];
}

async function updateProfile(supabase, profileId, changes) {
  const { data, error } = await supabase
    .from('profiles')
    .update(changes)
    .eq('id', profileId)
    .select('id');

  if (error) {
    throw new Error(`Billing state update failed: ${error.message}`);
  }

  if (!data?.length) {
    throw new Error('Billing state update matched no profile');
  }
}

export async function syncCustomerSubscription({
  stripe,
  supabase,
  customerId,
  userId,
  env = process.env
}) {
  if (!customerId) {
    throw new Error('Stripe customer ID is required for subscription sync');
  }

  const profile = await findProfile(supabase, { userId, customerId });

  if (profile.stripe_customer_id && profile.stripe_customer_id !== customerId) {
    throw new Error('Stripe customer does not match the billing profile');
  }

  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 100
  });

  const canonical = chooseCanonicalSubscription(subscriptions.data ?? []);

  if (!canonical) {
    await updateProfile(supabase, profile.id, {
      plan: fallbackPlan(env),
      payment_status: fallbackPaymentStatus(env, 'canceled'),
      stripe_customer_id: customerId,
      stripe_subscription_id: null,
      stripe_subscription_created_at: null,
      subscription_status: null,
      subscription_cancel_at_period_end: false,
      subscription_current_period_end: null
    });

    return betaStandardIsFree(env) ? 'synced-beta-standard' : 'synced-free';
  }

  const status = canonical.status;
  let plan = fallbackPlan(env);

  if (ACCESS_STATUSES.has(status)) {
    const priceId = canonical.items?.data?.[0]?.price?.id;
    plan = planForPriceId(priceId, env);

    if (!plan) {
      throw new Error('Active subscription uses an unknown Stripe price');
    }
  } else if (
    !NON_RENEWABLE_STATUSES.has(status) &&
    status !== 'incomplete' &&
    status !== 'paused'
  ) {
    throw new Error(`Unsupported Stripe subscription status: ${status}`);
  }

  const paidAccess = ACCESS_STATUSES.has(status);

  await updateProfile(supabase, profile.id, {
    plan,
    payment_status: paidAccess
      ? paymentStatusForSubscription(status)
      : fallbackPaymentStatus(env, status),
    stripe_customer_id: customerId,
    stripe_subscription_id: canonical.id,
    stripe_subscription_created_at: Number.isInteger(canonical.created)
      ? canonical.created
      : null,
    subscription_status: status,
    subscription_cancel_at_period_end:
      cancellationScheduledAtCurrentPeriodEnd(canonical),
    subscription_current_period_end: currentPeriodEnd(canonical)
  });

  return 'synced';
}

export async function processStripeEvent({
  stripe,
  supabase,
  event,
  env = process.env
}) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const customerId = stripeId(session.customer);
      const userId = session.metadata?.userId || session.client_reference_id;

      if (!customerId || !userId) {
        throw new Error('Checkout session is missing billing identifiers');
      }

      return syncCustomerSubscription({
        stripe,
        supabase,
        customerId,
        userId,
        env
      });
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const customerId = stripeId(subscription.customer);
      const userId = subscription.metadata?.userId || null;

      if (!customerId) {
        throw new Error('Subscription event is missing a Stripe customer');
      }

      return syncCustomerSubscription({
        stripe,
        supabase,
        customerId,
        userId,
        env
      });
    }

    case 'invoice.paid':
    case 'invoice.payment_failed':
    case 'invoice.finalization_failed': {
      const customerId = stripeId(event.data.object.customer);

      if (!customerId) {
        throw new Error('Invoice event is missing a Stripe customer');
      }

      return syncCustomerSubscription({
        stripe,
        supabase,
        customerId,
        env
      });
    }

    default:
      return 'ignored';
  }
}
