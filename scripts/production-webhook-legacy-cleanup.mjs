import Stripe from 'stripe';

import {
  findLegacyWebhookEndpoints,
  inspectWebhookEndpoint,
  removeVerifiedLegacyWebhookEndpoints
} from './stripe-production-webhook-endpoint.mjs';

const CANONICAL_APP_URL = 'https://novelrise.vercel.app';
const stripeKey = process.env.STRIPE_LIVE_SECRET_KEY;
const appUrl = (process.env.NOVELIGHT_APP_URL || '').replace(/\/+$/, '');

if (!stripeKey?.startsWith('sk_live_')) {
  throw new Error('STRIPE_LIVE_SECRET_KEY must be a live Stripe secret key');
}
if (appUrl !== CANONICAL_APP_URL) {
  throw new Error('Refusing non-canonical Production app URL');
}

const stripe = new Stripe(stripeKey);
const webhookUrl = `${appUrl}/api/stripe-webhook`;
const current = await inspectWebhookEndpoint({
  stripe,
  webhookUrl,
  hasExistingWebhookSecret: true,
  rotateWebhookSecret: false
});

if (!current?.id) {
  throw new Error('Canonical Production Stripe webhook endpoint is missing');
}

const legacy = await findLegacyWebhookEndpoints({ stripe, webhookUrl });
if (legacy.length === 0) {
  console.log('No active legacy NOVELIGHT webhook endpoints require cleanup.');
  process.exit(0);
}

console.log(
  `Verified ${legacy.length} active legacy NOVELIGHT webhook endpoint(s); removing them while preserving canonical endpoint ${current.id}.`
);

const removed = await removeVerifiedLegacyWebhookEndpoints({
  stripe,
  webhookUrl,
  legacyEndpointIds: legacy.map((endpoint) => endpoint.id),
  currentEndpointId: current.id
});

if (removed.length !== legacy.length) {
  throw new Error(
    `Legacy webhook cleanup removed ${removed.length} of ${legacy.length} verified endpoints`
  );
}

console.log(
  `Removed ${removed.length} legacy NOVELIGHT webhook endpoint(s). Canonical Production endpoint remains unchanged.`
);
