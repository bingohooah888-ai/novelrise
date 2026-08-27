const PAID_PLANS = new Set(['standard', 'premium']);

function isMissingCustomerError(error) {
  return (
    error?.type === 'StripeInvalidRequestError' &&
    error?.code === 'resource_missing' &&
    (!error?.param || error.param === 'customer' || error.param === 'id')
  );
}

async function loadTargetProfile(supabase, targetDisplayName) {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id,display_name,plan,payment_status,stripe_customer_id,stripe_subscription_id,stripe_subscription_created_at,subscription_status,subscription_cancel_at_period_end,subscription_current_period_end'
    )
    .eq('display_name', targetDisplayName)
    .limit(2);

  if (error) {
    throw new Error(`Production profile lookup failed: ${error.message}`);
  }

  if ((data ?? []).length !== 1) {
    throw new Error(
      `Safety stop: expected exactly 1 profile named ${JSON.stringify(targetDisplayName)}, found ${(data ?? []).length}`
    );
  }

  return data[0];
}

async function confirmCustomerIsMissing(stripe, customerId) {
  try {
    const customer = await stripe.customers.retrieve(customerId);
    return Boolean(customer?.deleted);
  } catch (error) {
    if (isMissingCustomerError(error)) {
      return true;
    }
    throw error;
  }
}

function assertRepairableProfile(profile) {
  if (!PAID_PLANS.has(profile.plan)) {
    throw new Error(
      `Safety stop: target profile is ${profile.plan ?? 'unknown'}, not a paid plan`
    );
  }

  if (profile.payment_status !== 'active') {
    throw new Error(
      `Safety stop: target payment_status is ${profile.payment_status ?? 'unknown'}, expected active`
    );
  }

  if (!profile.stripe_customer_id) {
    throw new Error('Safety stop: target has no stripe_customer_id');
  }
}

function isResetState(profile) {
  return (
    profile.plan === 'free' &&
    profile.payment_status === 'canceled' &&
    profile.stripe_customer_id === null &&
    profile.stripe_subscription_id === null &&
    profile.stripe_subscription_created_at === null &&
    profile.subscription_status === null &&
    profile.subscription_cancel_at_period_end === false &&
    profile.subscription_current_period_end === null
  );
}

export async function repairMissingProductionCustomer({
  supabase,
  stripe,
  targetDisplayName,
  logger = console
}) {
  if (!targetDisplayName?.trim()) {
    throw new Error('TARGET_DISPLAY_NAME is required');
  }

  const profile = await loadTargetProfile(supabase, targetDisplayName.trim());
  assertRepairableProfile(profile);

  const missing = await confirmCustomerIsMissing(
    stripe,
    profile.stripe_customer_id
  );

  if (!missing) {
    throw new Error(
      'Safety stop: Stripe customer still exists; refusing to reset an active paid profile'
    );
  }

  logger.warn(
    `Confirmed missing Stripe customer for ${JSON.stringify(profile.display_name)}; applying approved reset to Free`
  );

  const { data, error } = await supabase
    .from('profiles')
    .update({
      plan: 'free',
      payment_status: 'canceled',
      stripe_customer_id: null,
      stripe_subscription_id: null,
      stripe_subscription_created_at: null,
      subscription_status: null,
      subscription_cancel_at_period_end: false,
      subscription_current_period_end: null
    })
    .eq('id', profile.id)
    .eq('display_name', profile.display_name)
    .eq('plan', profile.plan)
    .eq('payment_status', profile.payment_status)
    .eq('stripe_customer_id', profile.stripe_customer_id)
    .select(
      'id,display_name,plan,payment_status,stripe_customer_id,stripe_subscription_id,stripe_subscription_created_at,subscription_status,subscription_cancel_at_period_end,subscription_current_period_end'
    )
    .limit(1);

  if (error) {
    throw new Error(`Production billing reset failed: ${error.message}`);
  }

  if ((data ?? []).length !== 1) {
    throw new Error(
      'Safety stop: optimistic Production reset matched no profile; state may have changed concurrently'
    );
  }

  const repaired = data[0];

  if (!isResetState(repaired)) {
    throw new Error('Production billing reset verification failed');
  }

  logger.log(
    `Production billing reset verified for ${JSON.stringify(repaired.display_name)}: free/canceled with Stripe references cleared`
  );

  return {
    displayName: repaired.display_name,
    plan: repaired.plan,
    paymentStatus: repaired.payment_status,
    verified: true
  };
}
