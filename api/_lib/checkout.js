import { getAppBaseUrl } from './app-base-url.js';

const PRICE_ENV_BY_PLAN = Object.freeze({
  standard: 'STRIPE_STANDARD_PRICE_ID',
  premium: 'STRIPE_PREMIUM_PRICE_ID'
});

const PORTAL_STATUSES = new Set([
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'incomplete',
  'paused'
]);

class BillingStateConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BillingStateConflictError';
    this.code = 'billing_state_conflict';
    this.details = details;
  }
}

function getBearerToken(authorization) {
  const bearerMatch =
    typeof authorization === 'string'
      ? authorization.match(/^Bearer\s+(\S+)$/i)
      : null;

  return bearerMatch?.[1] ?? null;
}

function getPortalConfiguration(env) {
  const configuration = env.STRIPE_PORTAL_CONFIGURATION_ID;
  return configuration ? { configuration } : {};
}

function isMissingStripeResource(error) {
  return (
    error?.type === 'StripeInvalidRequestError' &&
    error?.code === 'resource_missing'
  );
}

function isMissingStripeCustomer(error) {
  return isMissingStripeResource(error) && error?.param === 'customer';
}

async function getProfile(supabase, userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('plan, stripe_customer_id')
    .eq('id', userId)
    .limit(1);

  if (error) {
    throw new Error(`Profile lookup failed: ${error.message}`);
  }

  return data?.[0] ?? null;
}

async function clearStaleFreeCustomer(supabase, { userId, customerId }) {
  const { data, error } = await supabase
    .from('profiles')
    .update({
      payment_status: 'canceled',
      stripe_customer_id: null,
      stripe_subscription_id: null,
      stripe_subscription_created_at: null,
      subscription_status: null,
      subscription_cancel_at_period_end: false,
      subscription_current_period_end: null
    })
    .eq('id', userId)
    .eq('plan', 'free')
    .eq('stripe_customer_id', customerId)
    .select('id')
    .limit(1);

  if (error) {
    throw new Error(`Stale Stripe customer repair failed: ${error.message}`);
  }

  if (!data?.length) {
    throw new Error('Stale Stripe customer repair matched no free profile');
  }
}

async function resolveCustomerUsage(stripe, supabase, profile, userId) {
  const customer = profile.stripe_customer_id || undefined;

  if (!customer) {
    return {
      customer: undefined,
      usePortal: profile.plan !== 'free'
    };
  }

  if (profile.plan !== 'free') {
    return {
      customer,
      usePortal: true
    };
  }

  try {
    const subscriptions = await stripe.subscriptions.list({
      customer,
      status: 'all',
      limit: 100
    });

    return {
      customer,
      usePortal: (subscriptions.data ?? []).some((subscription) =>
        PORTAL_STATUSES.has(subscription.status)
      )
    };
  } catch (error) {
    if (!isMissingStripeResource(error)) {
      throw error;
    }

    await clearStaleFreeCustomer(supabase, {
      userId,
      customerId: customer
    });

    console.warn('Cleared stale Stripe customer reference for a free profile');

    return {
      customer: undefined,
      usePortal: false
    };
  }
}

export function createCheckoutHandler({ stripe, supabase, env = process.env }) {
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({
        error: 'Method not allowed'
      });
    }

    try {
      const token = getBearerToken(req.headers.authorization);

      if (!token) {
        return res.status(401).json({
          error: 'Unauthorized'
        });
      }

      const { data, error: authError } = await supabase.auth.getUser(token);

      if (authError || !data.user || !data.user.email) {
        return res.status(401).json({
          error: 'Unauthorized'
        });
      }

      const plan = req.body?.plan;
      const priceEnvName =
        typeof plan === 'string' ? PRICE_ENV_BY_PLAN[plan] : undefined;

      if (!priceEnvName) {
        return res.status(400).json({
          error: 'Invalid plan'
        });
      }

      const priceId = env[priceEnvName];

      if (!priceId) {
        console.error(`Missing Stripe price configuration: ${priceEnvName}`);

        return res.status(500).json({
          error: 'Checkout is not configured'
        });
      }

      const userId = data.user.id;
      const email = data.user.email;
      const profile = await getProfile(supabase, userId);

      if (!profile) {
        return res.status(409).json({
          error: 'Author profile is not ready'
        });
      }

      const { customer, usePortal } = await resolveCustomerUsage(
        stripe,
        supabase,
        profile,
        userId
      );

      if (usePortal) {
        if (!customer) {
          throw new BillingStateConflictError(
            'Paid profile is missing stripe_customer_id',
            { reason: 'missing_customer_reference', userId }
          );
        }

        try {
          const portalSession = await stripe.billingPortal.sessions.create({
            customer,
            return_url: `${getAppBaseUrl(env)}/pricing.html`,
            ...getPortalConfiguration(env)
          });

          return res.status(200).json({
            url: portalSession.url,
            mode: 'portal'
          });
        } catch (error) {
          if (isMissingStripeCustomer(error)) {
            throw new BillingStateConflictError(
              'Paid profile references a Stripe customer that does not exist',
              { reason: 'stripe_customer_missing', userId }
            );
          }
          throw error;
        }
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        ...(customer ? { customer } : { customer_email: email }),
        client_reference_id: userId,
        metadata: {
          userId,
          plan
        },
        subscription_data: {
          metadata: {
            userId,
            plan
          }
        },
        line_items: [
          {
            price: priceId,
            quantity: 1
          }
        ],
        success_url: `${getAppBaseUrl(env)}/mypage.html?checkout=success`,
        cancel_url: `${getAppBaseUrl(env)}/pricing.html?checkout=cancel`
      });

      return res.status(200).json({
        url: session.url,
        mode: 'checkout'
      });
    } catch (error) {
      if (error?.code === 'billing_state_conflict') {
        console.error('Checkout billing state conflict', {
          code: error.code,
          reason: error.details?.reason,
          userId: error.details?.userId
        });

        return res.status(409).json({
          error: 'Billing account needs repair',
          code: 'billing_state_conflict'
        });
      }

      console.error('Checkout session creation failed', {
        name: error?.name,
        type: error?.type,
        code: error?.code,
        param: error?.param
      });

      return res.status(500).json({
        error: 'Checkout session creation failed'
      });
    }
  };
}
