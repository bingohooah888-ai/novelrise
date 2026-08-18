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

      const { data: updatedProfiles, error } = await supabaseAdmin
  .from('profiles')
  .update({
    plan: plan,
    stripe_customer_id: session.customer,
  })
  .eq('id', userId)
  .select('id, plan, stripe_customer_id');

if (error) {
  throw new Error(
    `Supabase update failed: ${error.message}`
  );
}

console.log('Updated profiles:', updatedProfiles);

if (!updatedProfiles || updatedProfiles.length === 0) {
  throw new Error(
    `Profile not found for userId: ${userId}`
  );
}

console.log('Plan updated successfully:', updatedProfiles[0]);
    }
if (event.type === 'customer.subscription.deleted') {
  const subscription = event.data.object;

  const customerId = subscription.customer;

  console.log('Subscription deleted:', subscription.id);
  console.log('Customer ID:', customerId);

  const { data: profiles, error: findError } =
    await supabaseAdmin
      .from('profiles')
      .select('id, stripe_customer_id')
      .eq('stripe_customer_id', customerId);

  if (findError) {
    throw new Error(
      `Profile lookup failed: ${findError.message}`
    );
  }

  if (!profiles || profiles.length === 0) {
    throw new Error(
      `Profile not found for customerId: ${customerId}`
    );
  }

  const { error: updateError } =
    await supabaseAdmin
      .from('profiles')
      .update({
        plan: 'free',
      })
      .eq('id', profiles[0].id);

  if (updateError) {
    throw new Error(
      `Plan reset failed: ${updateError.message}`
    );
  }

  console.log('Plan reset to free:', profiles[0].id);
}

    if (event.type === 'invoice.payment_failed') {
  const invoice = event.data.object;

  const customerId = invoice.customer;

  console.log('Payment failed:', invoice.id);
  console.log('Customer ID:', customerId);

  const { data: profiles, error: findError } =
    await supabaseAdmin
      .from('profiles')
      .select('id, stripe_customer_id, plan')
      .eq('stripe_customer_id', customerId);

  if (findError) {
    throw new Error(
      `Profile lookup failed: ${findError.message}`
    );
  }

  if (!profiles || profiles.length === 0) {
    throw new Error(
      `Profile not found for customerId: ${customerId}`
    );
  }
const { error: paymentStatusError } =
  await supabaseAdmin
    .from('profiles')
    .update({
      payment_status: 'failed',
    })
    .eq('id', profiles[0].id);

if (paymentStatusError) {
  throw new Error(
    `Payment status update failed: ${paymentStatusError.message}`
  );
}
  console.log('Payment failed for profile:', profiles[0]);
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
