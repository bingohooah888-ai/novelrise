import fs from 'node:fs';
import Stripe from 'stripe';

const stripeKey = process.env.STRIPE_LIVE_SECRET_KEY;
const outputPath = process.env.STRIPE_BOOTSTRAP_OUTPUT;
const appUrl = (process.env.NOVELIGHT_APP_URL || 'https://novelrise.vercel.app').replace(/\/+$/, '');
const hasExistingWebhookSecret = process.env.VERCEL_HAS_WEBHOOK_SECRET === 'true';

if (!stripeKey?.startsWith('sk_live_')) {
  throw new Error('STRIPE_LIVE_SECRET_KEY must be a live Stripe secret key');
}

if (!outputPath) {
  throw new Error('STRIPE_BOOTSTRAP_OUTPUT is required');
}

const stripe = new Stripe(stripeKey);

const plans = [
  {
    key: 'standard',
    name: 'NOVELIGHT Standard',
    amount: 980,
    lookupKey: 'novelight_standard_monthly_jpy'
  },
  {
    key: 'premium',
    name: 'NOVELIGHT Premium',
    amount: 1980,
    lookupKey: 'novelight_premium_monthly_jpy'
  }
];

const requiredWebhookEvents = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.finalization_failed'
];

function productId(price) {
  return typeof price.product === 'string' ? price.product : price.product?.id;
}

async function inspectWebhookEndpoint() {
  const webhookUrl = `${appUrl}/api/stripe-webhook`;
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const matching = endpoints.data.filter((endpoint) => endpoint.url === webhookUrl);

  if (matching.length > 1) {
    throw new Error(`Multiple Stripe webhook endpoints target ${webhookUrl}`);
  }

  if (matching.length === 1) {
    if (!matching[0].livemode) {
      throw new Error('Existing NOVELIGHT webhook endpoint is not in live mode');
    }

    if (!hasExistingWebhookSecret) {
      throw new Error(
        'A live NOVELIGHT webhook endpoint already exists, but Vercel has no STRIPE_WEBHOOK_SECRET. Rotate or recreate the endpoint before continuing.'
      );
    }

    return matching[0];
  }

  return null;
}

async function ensurePrice(plan) {
  const existing = await stripe.prices.list({
    active: true,
    lookup_keys: [plan.lookupKey],
    limit: 10,
    expand: ['data.product']
  });

  if (existing.data.length > 1) {
    throw new Error(`Multiple active Stripe prices use lookup key ${plan.lookupKey}`);
  }

  if (existing.data.length === 1) {
    const price = existing.data[0];
    if (
      !price.livemode ||
      price.currency !== 'jpy' ||
      price.unit_amount !== plan.amount ||
      price.recurring?.interval !== 'month' ||
      price.recurring?.interval_count !== 1
    ) {
      throw new Error(`Existing Stripe price ${plan.lookupKey} does not match NOVELIGHT production pricing`);
    }

    return {
      priceId: price.id,
      productId: productId(price)
    };
  }

  const price = await stripe.prices.create({
    currency: 'jpy',
    unit_amount: plan.amount,
    recurring: {
      interval: 'month',
      interval_count: 1
    },
    lookup_key: plan.lookupKey,
    nickname: `${plan.name} monthly JPY`,
    product_data: {
      name: plan.name,
      metadata: {
        novelight_managed: 'true',
        novelight_plan: plan.key
      }
    },
    metadata: {
      novelight_managed: 'true',
      novelight_plan: plan.key
    }
  });

  if (!price.livemode) {
    throw new Error(`Created Stripe price ${price.id} is not in live mode`);
  }

  return {
    priceId: price.id,
    productId: productId(price)
  };
}

async function ensurePortalConfiguration(standard, premium) {
  const configs = await stripe.billingPortal.configurations.list({ limit: 100 });
  const managed = configs.data.filter(
    (config) => config.metadata?.novelight_managed === 'true'
  );

  if (managed.length > 1) {
    throw new Error('Multiple NOVELIGHT-managed Stripe portal configurations exist');
  }

  const payload = {
    business_profile: {
      headline: 'NOVELIGHT 契約管理',
      privacy_policy_url: `${appUrl}/privacy.html`,
      terms_of_service_url: `${appUrl}/terms.html`
    },
    default_return_url: `${appUrl}/mypage.html`,
    features: {
      customer_update: {
        enabled: true,
        allowed_updates: ['email', 'name']
      },
      invoice_history: {
        enabled: true
      },
      payment_method_update: {
        enabled: true
      },
      subscription_cancel: {
        enabled: true,
        mode: 'at_period_end',
        proration_behavior: 'none',
        cancellation_reason: {
          enabled: true,
          options: ['too_expensive', 'missing_features', 'switched_service', 'unused', 'other']
        }
      },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price'],
        proration_behavior: 'create_prorations',
        products: [
          {
            product: standard.productId,
            prices: [standard.priceId]
          },
          {
            product: premium.productId,
            prices: [premium.priceId]
          }
        ],
        schedule_at_period_end: {
          conditions: [{ type: 'decreasing_item_amount' }]
        }
      }
    },
    metadata: {
      novelight_managed: 'true'
    }
  };

  if (managed.length === 1) {
    const config = await stripe.billingPortal.configurations.update(managed[0].id, payload);
    if (!config.livemode) {
      throw new Error('NOVELIGHT portal configuration is not in live mode');
    }
    return config.id;
  }

  const config = await stripe.billingPortal.configurations.create(payload);
  if (!config.livemode) {
    throw new Error('Created NOVELIGHT portal configuration is not in live mode');
  }
  return config.id;
}

async function ensureWebhookEndpoint(existingEndpoint) {
  const webhookUrl = `${appUrl}/api/stripe-webhook`;

  if (existingEndpoint) {
    const endpoint = await stripe.webhookEndpoints.update(existingEndpoint.id, {
      description: 'NOVELIGHT production subscription synchronization',
      enabled_events: requiredWebhookEvents
    });

    return {
      endpointId: endpoint.id,
      secret: null
    };
  }

  const endpoint = await stripe.webhookEndpoints.create({
    url: webhookUrl,
    description: 'NOVELIGHT production subscription synchronization',
    enabled_events: requiredWebhookEvents
  });

  if (!endpoint.livemode || !endpoint.secret) {
    throw new Error('Stripe did not return a live webhook signing secret');
  }

  return {
    endpointId: endpoint.id,
    secret: endpoint.secret
  };
}

const existingWebhook = await inspectWebhookEndpoint();
const standard = await ensurePrice(plans[0]);
const premium = await ensurePrice(plans[1]);
const portalConfigurationId = await ensurePortalConfiguration(standard, premium);
const webhook = await ensureWebhookEndpoint(existingWebhook);

const output = {
  standardPriceId: standard.priceId,
  premiumPriceId: premium.priceId,
  portalConfigurationId,
  webhookEndpointId: webhook.endpointId,
  webhookSecret: webhook.secret
};

fs.writeFileSync(outputPath, `${JSON.stringify(output)}\n`, {
  encoding: 'utf8',
  mode: 0o600
});

console.log('Stripe live billing objects are configured and validated.');
