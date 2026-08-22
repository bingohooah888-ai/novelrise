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

function getBearerToken(authorization) {
  const bearerMatch =
    typeof authorization === 'string'
      ? authorization.match(/^Bearer\s+(\S+)$/i)
      : null;

  return bearerMatch?.[1] ?? null;
}

function getAppBaseUrl(env) {
  return (env.NOVELIGHT_APP_URL || 'https://novelrise.vercel.app').replace(
    /\/+$/,
    ''
  );
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

async function shouldUsePortal(stripe, profile) {
  if (!profile.stripe_customer_id) {
    return profile.plan !== 'free';
  }

  if (profile.plan !== 'free') {
    return true;
  }

  const subscriptions = await stripe.subscriptions.list({
    customer: profile.stripe_customer_id,
    status: 'all',
    limit: 100
  });

  return (subscriptions.data ?? []).some((subscription) =>
    PORTAL_STATUSES.has(subscription.status)
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

      if (await shouldUsePortal(stripe, profile)) {
        if (!profile.stripe_customer_id) {
          throw new Error('Paid profile is missing stripe_customer_id');
        }

        const portalSession = await stripe.billingPortal.sessions.create({
          customer: profile.stripe_customer_id,
          return_url: `${getAppBaseUrl(env)}/pricing.html`
        });

        return res.status(200).json({
          url: portalSession.url,
          mode: 'portal'
        });
      }

      const customer = profile.stripe_customer_id || undefined;
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
      console.error('Checkout session creation failed', {
        name: error?.name,
        type: error?.type,
        code: error?.code
      });

      return res.status(500).json({
        error: 'Checkout session creation failed'
      });
    }
  };
}
