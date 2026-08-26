import fs from 'node:fs';
import Stripe from 'stripe';
import {
  ensureWebhookEndpoint,
  inspectWebhookEndpoint
} from './stripe-production-webhook-endpoint.mjs';

const stripeKey = process.env.STRIPE_LIVE_SECRET_KEY;
const outputPath = process.env.STRIPE_BOOTSTRAP_OUTPUT;
const appUrl = (process.env.NOVELIGHT_APP_URL || 'https://novelrise.vercel.app').replace(/\/+$/, '');
const hasExistingWebhookSecret = process.env.VERCEL_HAS_WEBHOOK_SECRET === 'true';
const rotateWebhookSecret = process.env.STRIPE_ROTATE_WEBHOOK_SECRET === 'true';

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

function productId(price) {
  return typeof price.product === 'string' ? price.product : price.product?.id;
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

const webhookUrl = `${appUrl}/api/stripe-webhook`;
const existingWebhook = await inspectWebhookEndpoint({
  stripe,
  webhookUrl,
  hasExistingWebhookSecret,
  rotateWebhookSecret
});
const standard = await ensurePrice(plans[0]);
const premium = await ensurePrice(plans[1]);
const portalConfigurationId = await ensurePortalConfiguration(standard, premium);
const webhook = await ensureWebhookEndpoint({
  stripe,
  webhookUrl,
  existingEndpoint: existingWebhook,
  rotateWebhookSecret
});

const output = {
  standardPriceId: standard.priceId,
  premiumPriceId: premium.priceId,
  portalConfigurationId,
  webhookEndpointId: webhook.endpointId,
  webhookPreviousEndpointId: webhook.previousEndpointId,
  webhookSecret: webhook.secret
};

fs.writeFileSync(outputPath, `${JSON.stringify(output)}\n`, {
  encoding: 'utf8',
  mode: 0o600
});

console.log(
  rotateWebhookSecret && webhook.rotated
    ? 'Stripe live billing objects are configured and a replacement webhook endpoint is ready for secret sync.'
    : 'Stripe live billing objects are configured and validated.'
);
