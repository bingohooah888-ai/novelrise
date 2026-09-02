import Stripe from 'stripe';

const stripeKey = process.env.STRIPE_LIVE_SECRET_KEY;
const standardPriceId = process.env.STRIPE_STANDARD_PRICE_ID;
const premiumPriceId = process.env.STRIPE_PREMIUM_PRICE_ID;
const premiumLegacyPriceId = process.env.STRIPE_PREMIUM_LEGACY_PRICE_ID || null;

if (!stripeKey?.startsWith('sk_live_')) {
  throw new Error('STRIPE_LIVE_SECRET_KEY must be a live Stripe secret key');
}
if (!standardPriceId?.startsWith('price_')) {
  throw new Error('STRIPE_STANDARD_PRICE_ID is required');
}
if (!premiumPriceId?.startsWith('price_')) {
  throw new Error('STRIPE_PREMIUM_PRICE_ID is required');
}
if (premiumLegacyPriceId && !premiumLegacyPriceId.startsWith('price_')) {
  throw new Error('STRIPE_PREMIUM_LEGACY_PRICE_ID is invalid');
}
if (premiumLegacyPriceId === premiumPriceId) {
  throw new Error('Premium legacy and beta price IDs must differ');
}

const stripe = new Stripe(stripeKey);
const terminalStatuses = new Set(['canceled', 'incomplete_expired']);

async function subscriptionsForPrice(priceId) {
  const subscriptions = [];
  for await (const subscription of stripe.subscriptions.list({
    price: priceId,
    status: 'all',
    limit: 100
  })) {
    subscriptions.push(subscription);
  }
  return subscriptions;
}

function singleMatchingItem(subscription, expectedPriceId) {
  const items = subscription.items?.data || [];
  if (items.length !== 1 || items[0]?.price?.id !== expectedPriceId) {
    throw new Error(
      `Subscription ${subscription.id} is not a single-item NOVELIGHT subscription for the expected price`
    );
  }
  return items[0];
}

async function cancelPaidStandardSubscriptions() {
  const subscriptions = await subscriptionsForPrice(standardPriceId);
  let canceled = 0;

  for (const subscription of subscriptions) {
    if (terminalStatuses.has(subscription.status)) continue;
    singleMatchingItem(subscription, standardPriceId);

    if (subscription.metadata?.plan && subscription.metadata.plan !== 'standard') {
      throw new Error(
        `Subscription ${subscription.id} uses the Standard price but metadata plan is not standard`
      );
    }

    await stripe.subscriptions.cancel(subscription.id, {
      invoice_now: false,
      prorate: false
    });
    canceled += 1;
  }

  return canceled;
}

async function migrateLegacyPremiumSubscriptions() {
  if (!premiumLegacyPriceId) return 0;

  const subscriptions = await subscriptionsForPrice(premiumLegacyPriceId);
  let migrated = 0;

  for (const subscription of subscriptions) {
    if (terminalStatuses.has(subscription.status)) continue;
    const item = singleMatchingItem(subscription, premiumLegacyPriceId);

    if (subscription.metadata?.plan && subscription.metadata.plan !== 'premium') {
      throw new Error(
        `Subscription ${subscription.id} uses the legacy Premium price but metadata plan is not premium`
      );
    }

    await stripe.subscriptions.update(subscription.id, {
      items: [{ id: item.id, price: premiumPriceId }],
      proration_behavior: 'none',
      metadata: {
        ...subscription.metadata,
        plan: 'premium',
        novelightBetaPrice: '480'
      }
    });
    migrated += 1;
  }

  return migrated;
}

const canceledStandard = await cancelPaidStandardSubscriptions();
const migratedPremium = await migrateLegacyPremiumSubscriptions();

console.log(
  `Beta pricing transition complete: canceled paid Standard subscriptions=${canceledStandard}, migrated legacy Premium subscriptions=${migratedPremium}.`
);
