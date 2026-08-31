import { randomUUID } from 'node:crypto';

import { getAppBaseUrl } from './app-base-url.js';

const PRICE_ENV_BY_PLAN = Object.freeze({
  standard: 'STRIPE_STANDARD_PRICE_ID',
  premium: 'STRIPE_PREMIUM_PRICE_ID'
});

const CHECKOUT_LEGAL_NOTICE_BY_PLAN = Object.freeze({
  standard:
    'Standardは月額980円の継続契約です。申込完了時に初回決済し、解約するまで毎月自動更新され、更新回数に上限はありません。1年間利用した場合の支払総額目安は11,760円です（1年契約を意味しません）。決済完了・契約状態確認後に有料機能を利用できます。解約はStripe顧客ポータルから行えます。法令上必要な場合、重複請求、NOVELIGHT側の重大な決済障害等を除き、利用者都合の途中返金・日割り返金は原則行いません。18歳未満の方は法定代理人の同意を得て申し込んでください。',
  premium:
    'Premiumは月額1,980円の継続契約です。申込完了時に初回決済し、解約するまで毎月自動更新され、更新回数に上限はありません。1年間利用した場合の支払総額目安は23,760円です（1年契約を意味しません）。決済完了・契約状態確認後に有料機能を利用できます。解約はStripe顧客ポータルから行えます。法令上必要な場合、重複請求、NOVELIGHT側の重大な決済障害等を除き、利用者都合の途中返金・日割り返金は原則行いません。18歳未満の方は法定代理人の同意を得て申し込んでください。'
});

const PORTAL_STATUSES = new Set([
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'incomplete',
  'paused'
]);

const CHECKOUT_ATTEMPT_CONFLICT_MESSAGES = new Set([
  'checkout_attempt_plan_conflict',
  'checkout_profile_not_free'
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

function firstRpcRow(data) {
  return Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
}

function checkoutAttemptConflict(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  return CHECKOUT_ATTEMPT_CONFLICT_MESSAGES.has(message);
}

function checkoutAttemptReason(error) {
  return error?.message === 'checkout_attempt_plan_conflict'
    ? 'checkout_attempt_plan_conflict'
    : 'billing_state_changed';
}

function checkoutExpiresAtEpoch(attempt) {
  const milliseconds = Date.parse(attempt?.expires_at);

  if (!Number.isFinite(milliseconds)) {
    throw new Error('Checkout attempt has an invalid expiration');
  }

  return Math.floor(milliseconds / 1000);
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

async function reserveCheckoutAttempt(supabase, { userId, plan }) {
  const { data, error } = await supabase.rpc(
    'novelight_reserve_checkout_attempt',
    {
      p_user_id: userId,
      p_plan: plan,
      p_candidate_attempt_id: randomUUID()
    }
  );

  if (error) {
    if (checkoutAttemptConflict(error)) {
      throw new BillingStateConflictError(
        'Checkout attempt conflicts with current billing state',
        {
          reason: checkoutAttemptReason(error),
          userId
        }
      );
    }

    throw new Error(`Checkout attempt reservation failed: ${error.message}`);
  }

  const attempt = firstRpcRow(data);

  if (!attempt?.attempt_id || attempt.plan !== plan || !attempt.expires_at) {
    throw new Error('Checkout attempt reservation returned invalid state');
  }

  return attempt;
}

async function attachCheckoutSession(
  supabase,
  { userId, attemptId, sessionId }
) {
  const { data, error } = await supabase.rpc(
    'novelight_attach_checkout_session',
    {
      p_user_id: userId,
      p_attempt_id: attemptId,
      p_stripe_session_id: sessionId
    }
  );

  if (error) {
    throw new Error(`Checkout session attachment failed: ${error.message}`);
  }

  if (data !== true) {
    throw new Error('Checkout session attachment was not confirmed');
  }
}

async function releaseCheckoutAttempt(supabase, { userId, attemptId }) {
  const { error } = await supabase.rpc('novelight_release_checkout_attempt', {
    p_user_id: userId,
    p_attempt_id: attemptId
  });

  if (error) {
    throw new Error(`Checkout attempt release failed: ${error.message}`);
  }
}

function buildCheckoutPayload({
  customer,
  email,
  env,
  expiresAt,
  plan,
  priceId,
  userId
}) {
  return {
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
    custom_text: {
      submit: {
        message: CHECKOUT_LEGAL_NOTICE_BY_PLAN[plan]
      }
    },
    expires_at: expiresAt,
    success_url: `${getAppBaseUrl(env)}/mypage.html?checkout=success`,
    cancel_url: `${getAppBaseUrl(env)}/pricing.html?checkout=cancel`
  };
}

async function createReservedCheckoutSession({
  stripe,
  supabase,
  env,
  userId,
  email,
  plan,
  priceId,
  customer,
  attempt
}) {
  const session = await stripe.checkout.sessions.create(
    buildCheckoutPayload({
      customer,
      email,
      env,
      expiresAt: checkoutExpiresAtEpoch(attempt),
      plan,
      priceId,
      userId
    }),
    {
      idempotencyKey: `novelight-checkout:${userId}:${attempt.attempt_id}`
    }
  );

  if (!session?.id || !session?.url) {
    throw new Error('Stripe Checkout session is missing required fields');
  }

  await attachCheckoutSession(supabase, {
    userId,
    attemptId: attempt.attempt_id,
    sessionId: session.id
  });

  return session;
}

async function getOrCreateCheckoutSession({
  stripe,
  supabase,
  env,
  userId,
  email,
  plan,
  priceId,
  customer,
  retryAfterExpired = true
}) {
  const attempt = await reserveCheckoutAttempt(supabase, { userId, plan });

  if (!attempt.stripe_session_id) {
    return createReservedCheckoutSession({
      stripe,
      supabase,
      env,
      userId,
      email,
      plan,
      priceId,
      customer,
      attempt
    });
  }

  let existingSession;

  try {
    existingSession = await stripe.checkout.sessions.retrieve(
      attempt.stripe_session_id
    );
  } catch (error) {
    if (isMissingStripeResource(error)) {
      throw new BillingStateConflictError(
        'Stored Checkout session cannot be verified',
        {
          reason: 'checkout_session_missing',
          userId
        }
      );
    }

    throw error;
  }

  if (existingSession?.status === 'open' && existingSession.url) {
    return existingSession;
  }

  if (existingSession?.status === 'expired' && retryAfterExpired) {
    await releaseCheckoutAttempt(supabase, {
      userId,
      attemptId: attempt.attempt_id
    });

    return getOrCreateCheckoutSession({
      stripe,
      supabase,
      env,
      userId,
      email,
      plan,
      priceId,
      customer,
      retryAfterExpired: false
    });
  }

  throw new BillingStateConflictError(
    'Checkout session is no longer safely reusable',
    {
      reason:
        existingSession?.status === 'complete'
          ? 'checkout_completed_pending_sync'
          : 'checkout_session_state_conflict',
      userId
    }
  );
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

      const session = await getOrCreateCheckoutSession({
        stripe,
        supabase,
        env,
        userId,
        email,
        plan,
        priceId,
        customer
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
