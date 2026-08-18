import Stripe from 'stripe';

const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  try {
    const { plan, userId, email } = req.body;

    let priceId;

    if (plan === 'standard') {
      priceId =
        process.env.STRIPE_STANDARD_PRICE_ID;
    }

    if (plan === 'premium') {
      priceId =
        process.env.STRIPE_PREMIUM_PRICE_ID;
    }

    if (!priceId) {
      return res.status(400).json({
        error: 'Invalid plan'
      });
    }

    const session =
      await stripe.checkout.sessions.create({
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

        cancel_url:
          'https://novelrise.vercel.app/pricing.html?checkout=cancel'
      });

    return res.status(200).json({
      url: session.url
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error:
        'Checkout session creation failed'
    });
  }
}
