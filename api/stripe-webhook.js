import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { processStripeEvent } from './_lib/stripe-webhook.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

export const config = {
  api: {
    bodyParser: false
  }
};

async function getRawBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
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

    const result = await processStripeEvent({
      supabase: supabaseAdmin,
      event,
      env: process.env
    });

    return res.status(200).json({
      received: true,
      result
    });
  } catch (error) {
    console.error('Webhook processing failed', {
      name: error?.name,
      type: error?.type,
      code: error?.code,
      message: error?.message
    });

    return res.status(400).json({
      error: 'Webhook processing failed'
    });
  }
}
