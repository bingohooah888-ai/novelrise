import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(
      typeof chunk === 'string'
        ? Buffer.from(chunk)
        : chunk
    );
  }

  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed',
    });
  }

  try {
    const rawBody = await getRawBody(req);

    const signature = req.headers['stripe-signature'];

    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      console.log('Checkout completed:', session.id);
      console.log('Metadata:', session.metadata);
    }

    return res.status(200).json({
      received: true,
    });
  } catch (error) {
    console.error('Webhook error:', error.message);

    return res.status(400).json({
      error: error.message,
    });
  }
}
