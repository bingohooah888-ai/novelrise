const PRICE_ENV_BY_PLAN = Object.freeze({
  standard: 'STRIPE_STANDARD_PRICE_ID',
  premium: 'STRIPE_PREMIUM_PRICE_ID'
});

function getBearerToken(authorization) {
  const bearerMatch =
    typeof authorization === 'string'
      ? authorization.match(/^Bearer\s+(\S+)$/i)
      : null;

  return bearerMatch?.[1] ?? null;
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

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer_email: email,
        client_reference_id: userId,
        metadata: {
          userId: userId,
          plan: plan
        },
        line_items: [
          {
            price: priceId,
            quantity: 1
          }
        ],
        success_url:
          'https://novelrise.vercel.app/mypage.html?checkout=success',
        cancel_url: 'https://novelrise.vercel.app/pricing.html?checkout=cancel'
      });

      return res.status(200).json({
        url: session.url
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
