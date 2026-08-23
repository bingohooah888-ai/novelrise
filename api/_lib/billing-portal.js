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

function getPortalConfiguration(env) {
  const configuration = env.STRIPE_PORTAL_CONFIGURATION_ID;
  return configuration ? { configuration } : {};
}

export function createBillingPortalHandler({
  stripe,
  supabase,
  env = process.env
}) {
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

      if (authError || !data.user) {
        return res.status(401).json({
          error: 'Unauthorized'
        });
      }

      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', data.user.id)
        .limit(1);

      if (profileError) {
        throw new Error(`Profile lookup failed: ${profileError.message}`);
      }

      const customerId = profiles?.[0]?.stripe_customer_id;

      if (!customerId) {
        return res.status(409).json({
          error: 'No Stripe billing account exists for this user',
          code: 'NO_BILLING_ACCOUNT'
        });
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${getAppBaseUrl(env)}/mypage.html`,
        ...getPortalConfiguration(env)
      });

      return res.status(200).json({
        url: session.url
      });
    } catch (error) {
      console.error('Billing portal session creation failed', {
        name: error?.name,
        type: error?.type,
        code: error?.code
      });

      return res.status(500).json({
        error: 'Billing portal session creation failed'
      });
    }
  };
}
