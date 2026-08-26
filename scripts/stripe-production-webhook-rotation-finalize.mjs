import fs from 'node:fs';
import Stripe from 'stripe';
import { finalizeWebhookRotation } from './stripe-production-webhook-endpoint.mjs';

const stripeKey = process.env.STRIPE_LIVE_SECRET_KEY;
const outputPath = process.env.STRIPE_BOOTSTRAP_OUTPUT;

if (!stripeKey?.startsWith('sk_live_')) {
  throw new Error('STRIPE_LIVE_SECRET_KEY must be a live Stripe secret key');
}

if (!outputPath) {
  throw new Error('STRIPE_BOOTSTRAP_OUTPUT is required');
}

const output = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
const previousEndpointId = output.webhookPreviousEndpointId || null;
const currentEndpointId = output.webhookEndpointId || null;

if (!previousEndpointId) {
  console.log('No previous webhook endpoint requires rotation cleanup.');
  process.exit(0);
}

const stripe = new Stripe(stripeKey);
let lastError = null;

for (let attempt = 1; attempt <= 3; attempt += 1) {
  try {
    await finalizeWebhookRotation({
      stripe,
      previousEndpointId,
      currentEndpointId
    });
    console.log('Previous Stripe webhook endpoint removed after the replacement deployment became reachable.');
    process.exit(0);
  } catch (error) {
    lastError = error;
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

throw new Error(
  'Replacement webhook is deployed, but the previous Stripe webhook endpoint could not be removed after three attempts',
  { cause: lastError }
);
