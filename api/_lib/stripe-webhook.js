const ACCESS_STATUSES = new Set(['active', 'trialing', 'past_due']);
const REVOKE_STATUSES = new Set([
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused'
]);

function stripeId(value) {
  if (typeof value === 'string') {
    return value;
  }

  return value?.id ?? null;
}

function priceIdForPlan(plan, env) {
  if (plan === 'standard') {
    return env.STRIPE_STANDARD_PRICE_ID;
  }

  if (plan === 'premium') {
    return env.STRIPE_PREMIUM_PRICE_ID;
  }

  return null;
}

function planForPriceId(priceId, env) {
  if (priceId && priceId === priceIdForPlan('standard', env)) {
    return 'standard';
  }

  if (priceId && priceId === priceIdForPlan('premium', env)) {
    return 'premium';
  }

  return null;
}

function currentPeriodEnd(subscription) {
  const epochSeconds = subscription.items?.data?.[0]?.current_period_end;

  if (!Number.isInteger(epochSeconds)) {
    return null;
  }

  return new Date(epochSeconds * 1000).toISOString();
}

function subscriptionPaymentStatus(status) {
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
      return null;
  }
}

async function findProfile(supabase, column, value) {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, plan, stripe_customer_id, stripe_subscription_id, stripe_last_event_id, stripe_last_event_created_at'
    )
    .eq(column, value)
    .limit(2);

  if (error) {
    throw new Error(`Profile lookup failed: ${error.message}`);
  }

  if (!data || data.length === 0) {
    throw new Error(`Profile not found for ${column}`);
  }

  if (data.length > 1) {
    throw new Error(`Multiple profiles matched ${column}`);
  }

  return data[0];
}

async function applyEventUpdate({ supabase, profile, event, changes }) {
  if (!Number.isInteger(event.created)) {
    throw new Error('Stripe event is missing a valid created timestamp');
  }

  if (profile.stripe_last_event_id === event.id) {
    return 'duplicate';
  }

  const updatePayload = {
    ...changes,
    stripe_last_event_id: event.id,
    stripe_last_event_created_at: event.created
  };

  const { data, error } = await supabase
    .from('profiles')
    .update(updatePayload)
    .eq('id', profile.id)
    .or(
      `stripe_last_event_created_at.is.null,stripe_last_event_created_at.lte.${event.created}`
    )
    .select('id');

  if (error) {
    throw new Error(`Billing state update failed: ${error.message}`);
  }

  return data?.length ? 'updated' : 'stale';
}

async function handleCheckoutCompleted({ supabase, event }) {
  const session = event.data.object;
  const userId = session.metadata?.userId || session.client_reference_id;

  if (!userId) {
    throw new Error('Checkout session is missing a user identifier');
  }

  const profile = await findProfile(supabase, 'id', userId);
  const customerId = stripeId(session.customer);
  const subscriptionId = stripeId(session.subscription);

  if (!customerId) {
    throw new Error('Checkout session is missing a Stripe customer');
  }

  return applyEventUpdate({
    supabase,
    profile,
    event,
    changes: {
      stripe_customer_id: customerId,
      ...(subscriptionId ? { stripe_subscription_id: subscriptionId } : {})
    }
  });
}

async function handleSubscriptionChange({ supabase, event, env }) {
  const subscription = event.data.object;
  const customerId = stripeId(subscription.customer);

  if (!customerId || !subscription.id || !subscription.status) {
    throw new Error('Subscription event is missing required identifiers');
  }

  const profile = await findProfile(supabase, 'stripe_customer_id', customerId);
  const status = subscription.status;
  let plan;

  if (ACCESS_STATUSES.has(status)) {
    const priceId = subscription.items?.data?.[0]?.price?.id;
    plan = planForPriceId(priceId, env);

    if (!plan) {
      throw new Error('Subscription uses an unknown Stripe price');
    }
  } else if (REVOKE_STATUSES.has(status)) {
    plan = 'free';
  } else {
    throw new Error(`Unsupported Stripe subscription status: ${status}`);
  }

  const paymentStatus = subscriptionPaymentStatus(status);

  if (!paymentStatus) {
    throw new Error(`Unsupported payment state for subscription: ${status}`);
  }

  return applyEventUpdate({
    supabase,
    profile,
    event,
    changes: {
      plan,
      payment_status: paymentStatus,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      subscription_status: status,
      subscription_cancel_at_period_end:
        subscription.cancel_at_period_end === true,
      subscription_current_period_end: currentPeriodEnd(subscription)
    }
  });
}

async function handleInvoiceEvent({ supabase, event, paymentStatus }) {
  const invoice = event.data.object;
  const customerId = stripeId(invoice.customer);

  if (!customerId) {
    throw new Error('Invoice event is missing a Stripe customer');
  }

  const profile = await findProfile(supabase, 'stripe_customer_id', customerId);

  if (profile.plan === 'free') {
    return 'ignored-free-profile';
  }

  return applyEventUpdate({
    supabase,
    profile,
    event,
    changes: {
      payment_status: paymentStatus
    }
  });
}

export async function processStripeEvent({
  supabase,
  event,
  env = process.env
}) {
  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted({ supabase, event });
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return handleSubscriptionChange({ supabase, event, env });
    case 'invoice.paid':
      return handleInvoiceEvent({
        supabase,
        event,
        paymentStatus: 'active'
      });
    case 'invoice.payment_failed':
    case 'invoice.finalization_failed':
      return handleInvoiceEvent({
        supabase,
        event,
        paymentStatus: 'failed'
      });
    default:
      return 'ignored';
  }
}
