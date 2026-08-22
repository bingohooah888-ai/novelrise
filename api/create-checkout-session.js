import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

const PRICE_ENV_BY_PLAN = Object.freeze({
  standard: 'STRIPE_STANDARD_PRICE_ID',
  premium: 'STRIPE_PREMIUM_PRICE_ID'
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  try {
    const authorization = req.headers.authorization;
    const bearerMatch =
      typeof authorization === 'string'
        ? authorization.match(/^Bearer\s+(\S+)$/i)
        : null;

    if (!bearerMatch) {
      return res.status(401).json({
        error: 'Unauthorized'
      });
    }

    const { data, error: authError } = await supabase.auth.getUser(
      bearerMatch[1]
    );

    if (authError || !data.user || !data.user.email) {
      return res.status(401).json({
        error: 'Unauthorized'
      });
    }

    const plan = req.body?.plan;
    const isAllowedPlan =
      typeof plan === 'string' &&
      Object.prototype.hasOwnProperty.call(PRICE_ENV_BY_PLAN, plan);

    if (!isAllowedPlan) {
      return res.status(400).json({
        error: 'Invalid plan'
      });
    }

    const priceEnvName = PRICE_ENV_BY_PLAN[plan];
    const priceId = process.env[priceEnvName];

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
      success_url: 'https://novelrise.vercel.app/mypage.html?checkout=success',
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
}
