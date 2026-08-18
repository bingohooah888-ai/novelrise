import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

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

      const userId = session.metadata?.userId;
      const plan = session.metadata?.plan;

      console.log('Checkout completed:', session.id);
      console.log('User ID:', userId);
      console.log('Plan:', plan);

      if (!userId || !plan) {
        throw new Error('Missing userId or plan in metadata');
      }

      const { error } = await supabaseAdmin
        .from('profiles')
        .update({
          plan: plan,
        })
        .eq('id', userId);

      if (error) {
        throw new Error(
          `Supabase update failed: ${error.message}`
        );
      }

      console.log('Plan updated successfully:', plan);
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
