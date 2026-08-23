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

function stripeId(value) {
  return typeof value === 'string' ? value : (value?.id ?? null);
}

async function recordSubscriptionAuditEvent(event) {
  const object = event?.data?.object ?? {};
  const customerId = stripeId(object.customer);
  const userId = object.metadata?.userId || object.client_reference_id || null;

  if (!event?.id || (!customerId && !userId)) return;

  let query = supabaseAdmin
    .from('profiles')
    .select(
      'id, plan, payment_status, stripe_customer_id, stripe_subscription_id, subscription_status'
    );

  query = userId
    ? query.eq('id', userId)
    : query.eq('stripe_customer_id', customerId);
  const { data: profiles, error: profileError } = await query.limit(2);

  if (profileError) {
    throw new Error(
      `Stripe audit profile lookup failed: ${profileError.message}`
    );
  }
  if (!profiles?.length) throw new Error('Stripe audit profile was not found');
  if (profiles.length > 1) {
    throw new Error('Stripe audit profile lookup was ambiguous');
  }

  const profile = profiles[0];
  const eventCreatedAt = Number.isInteger(event.created)
    ? new Date(event.created * 1000).toISOString()
    : null;

  const { error: auditError } = await supabaseAdmin
    .from('subscription_event_log')
    .upsert(
      {
        stripe_event_id: event.id,
        event_type: event.type,
        user_id: profile.id,
        stripe_customer_id: profile.stripe_customer_id || customerId,
        stripe_subscription_id: profile.stripe_subscription_id,
        plan_snapshot: profile.plan || 'free',
        subscription_status: profile.subscription_status,
        payment_status: profile.payment_status,
        event_created_at: eventCreatedAt
      },
      {
        onConflict: 'stripe_event_id',
        ignoreDuplicates: true
      }
    );

  if (auditError) {
    throw new Error(`Stripe audit event write failed: ${auditError.message}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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
      stripe,
      supabase: supabaseAdmin,
      event,
      env: process.env
    });

    if (result !== 'ignored') {
      await recordSubscriptionAuditEvent(event);
    }

    return res.status(200).json({ received: true, result });
  } catch (error) {
    console.error('Webhook processing failed', {
      name: error?.name,
      type: error?.type,
      code: error?.code,
      message: error?.message
    });

    return res.status(400).json({ error: 'Webhook processing failed' });
  }
}
