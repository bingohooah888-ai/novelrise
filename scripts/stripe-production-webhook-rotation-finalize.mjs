import fs from 'node:fs';
import Stripe from 'stripe';
import {
  finalizeWebhookRotation,
  removeVerifiedLegacyWebhookEndpoints
} from './stripe-production-webhook-endpoint.mjs';

const stripeKey = process.env.STRIPE_LIVE_SECRET_KEY;
const outputPath = process.env.STRIPE_BOOTSTRAP_OUTPUT;
const appUrl = (process.env.NOVELIGHT_APP_URL || '').replace(/\/+$/, '');

if (!stripeKey?.startsWith('sk_live_')) {
  throw new Error('STRIPE_LIVE_SECRET_KEY must be a live Stripe secret key');
}

if (!outputPath) {
  throw new Error('STRIPE_BOOTSTRAP_OUTPUT is required');
}

if (appUrl !== 'https://novelrise.vercel.app') {
  throw new Error('Refusing non-canonical Production app URL');
}

const output = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
const previousEndpointId = output.webhookPreviousEndpointId || null;
const currentEndpointId = output.webhookEndpointId || null;
const legacyEndpointIds = Array.isArray(output.webhookLegacyEndpointIds)
  ? output.webhookLegacyEndpointIds
  : [];
const webhookUrl = `${appUrl}/api/stripe-webhook`;

if (!currentEndpointId) {
  throw new Error('Current NOVELIGHT webhook endpoint ID is missing');
}

const stripe = new Stripe(stripeKey);
let lastError = null;

for (let attempt = 1; attempt <= 3; attempt += 1) {
  try {
    const rotated = await finalizeWebhookRotation({
      stripe,
      previousEndpointId,
      currentEndpointId
    });
    const removedLegacy = await removeVerifiedLegacyWebhookEndpoints({
      stripe,
      webhookUrl,
      legacyEndpointIds,
      currentEndpointId
    });

    if (rotated) {
      console.log(
        'Previous Stripe webhook endpoint removed after the replacement deployment became reachable.'
      );
    }
    if (removedLegacy.length) {
      console.log(
        `Removed ${removedLegacy.length} verified legacy NOVELIGHT webhook endpoint(s) after the canonical Production deployment became reachable.`
      );
    }
    if (!rotated && removedLegacy.length === 0) {
      console.log('No superseded or legacy Stripe webhook endpoints require cleanup.');
    }
    process.exit(0);
  } catch (error) {
    lastError = error;
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

throw new Error(
  'Canonical Production webhook is reachable, but approved webhook cleanup could not complete after three attempts',
  { cause: lastError }
);
