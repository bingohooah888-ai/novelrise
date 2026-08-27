import {
  isLegacyNovelightWebhookEndpoint,
  managedWebhookDescription,
  requiredWebhookEvents
} from './stripe-production-webhook-endpoint.mjs';

const PAID_PLANS = new Set(['standard', 'premium']);
const ENTITLED_SUBSCRIPTION_STATUSES = new Set([
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'incomplete',
  'paused'
]);

export const REQUIRED_PRODUCTION_WEBHOOK_EVENTS = requiredWebhookEvents;

function isMissingStripeResource(error) {
  return (
    error?.type === 'StripeInvalidRequestError' &&
    error?.code === 'resource_missing'
  );
}

function normalizePathname(pathname) {
  return String(pathname || '').replace(/\/+$/, '') || '/';
}

function endpointIsEnabled(endpoint) {
  return !endpoint?.status || endpoint.status === 'enabled';
}

export { isLegacyNovelightWebhookEndpoint };

function issue(code, details = {}) {
  return { code, ...details };
}

function warning(code, details = {}) {
  return { code, ...details };
}

async function listProfiles(supabase) {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, display_name, plan, payment_status, stripe_customer_id, stripe_subscription_id, subscription_status'
    )
    .limit(10000);

  if (error) {
    throw new Error(
      `Production billing audit profile lookup failed: ${error.message}`
    );
  }

  return data || [];
}

async function inspectCustomer(stripe, profile) {
  const customerId = profile.stripe_customer_id;
  if (!customerId) {
    return { customerMissing: true, subscriptions: [] };
  }

  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer?.deleted) {
      return { customerMissing: true, subscriptions: [] };
    }
  } catch (error) {
    if (isMissingStripeResource(error)) {
      return { customerMissing: true, subscriptions: [] };
    }
    throw error;
  }

  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 100
  });

  return {
    customerMissing: false,
    subscriptions: subscriptions.data || []
  };
}

function activeSubscriptions(subscriptions) {
  return subscriptions.filter((subscription) =>
    ENTITLED_SUBSCRIPTION_STATUSES.has(subscription.status)
  );
}

function auditStoredSubscription(profile, subscriptions, issues) {
  if (!profile.stripe_subscription_id) return;

  if (
    !subscriptions.some(
      (subscription) => subscription.id === profile.stripe_subscription_id
    )
  ) {
    issues.push(
      issue('stored_subscription_missing_in_stripe', {
        profileId: profile.id,
        displayName: profile.display_name || null,
        stripeSubscriptionId: profile.stripe_subscription_id
      })
    );
  }
}

function auditDuplicateCustomers(profiles, issues) {
  const owners = new Map();

  for (const profile of profiles) {
    if (!profile.stripe_customer_id) continue;
    const list = owners.get(profile.stripe_customer_id) || [];
    list.push(profile.id);
    owners.set(profile.stripe_customer_id, list);
  }

  for (const [customerId, profileIds] of owners) {
    if (profileIds.length > 1) {
      issues.push(
        issue('duplicate_stripe_customer_reference', {
          stripeCustomerId: customerId,
          profileIds
        })
      );
    }
  }
}

function isDisabledLegacyEndpoint(endpoint, canonicalWebhookUrl) {
  if (endpoint?.status !== 'disabled' || endpoint?.url === canonicalWebhookUrl) {
    return false;
  }

  try {
    const endpointUrl = new URL(endpoint.url);
    const canonicalUrl = new URL(canonicalWebhookUrl);
    if (
      normalizePathname(endpointUrl.pathname) !==
      normalizePathname(canonicalUrl.pathname)
    ) {
      return false;
    }

    return (
      endpoint.description === managedWebhookDescription ||
      (endpointUrl.hostname.endsWith('.vercel.app') &&
        endpointUrl.hostname.startsWith('novelrise'))
    );
  } catch {
    return false;
  }
}

function auditWebhookEndpoints(endpoints, canonicalWebhookUrl, issues, warnings) {
  const exact = endpoints.filter(
    (endpoint) =>
      endpoint.url === canonicalWebhookUrl && endpointIsEnabled(endpoint)
  );

  if (exact.length !== 1) {
    issues.push(
      issue('canonical_webhook_endpoint_count', {
        expected: 1,
        actual: exact.length
      })
    );
  }

  if (exact.length === 1) {
    const enabledEvents = new Set(exact[0].enabled_events || []);
    const missingEvents = requiredWebhookEvents.filter(
      (event) => !enabledEvents.has(event)
    );
    if (missingEvents.length) {
      issues.push(
        issue('canonical_webhook_missing_events', {
          endpointId: exact[0].id,
          missingEvents
        })
      );
    }
  }

  const legacy = endpoints.filter((endpoint) =>
    isLegacyNovelightWebhookEndpoint(endpoint, canonicalWebhookUrl)
  );
  for (const endpoint of legacy) {
    issues.push(
      issue('legacy_novelight_webhook_endpoint', {
        endpointId: endpoint.id,
        url: endpoint.url
      })
    );
  }

  for (const endpoint of endpoints.filter((item) =>
    isDisabledLegacyEndpoint(item, canonicalWebhookUrl)
  )) {
    warnings.push(
      warning('disabled_legacy_novelight_webhook_endpoint', {
        endpointId: endpoint.id,
        url: endpoint.url
      })
    );
  }

  return { exact, legacy };
}

export async function auditProductionBilling({
  supabase,
  stripe,
  canonicalWebhookUrl
}) {
  const issues = [];
  const warnings = [];
  const profiles = await listProfiles(supabase);

  auditDuplicateCustomers(profiles, issues);

  for (const profile of profiles) {
    const paid = PAID_PLANS.has(profile.plan);

    if (paid && !profile.stripe_customer_id) {
      issues.push(
        issue('paid_profile_missing_customer_reference', {
          profileId: profile.id,
          displayName: profile.display_name || null,
          plan: profile.plan
        })
      );
      continue;
    }

    if (!profile.stripe_customer_id) continue;

    const { customerMissing, subscriptions } = await inspectCustomer(
      stripe,
      profile
    );

    if (customerMissing) {
      const payload = {
        profileId: profile.id,
        displayName: profile.display_name || null,
        stripeCustomerId: profile.stripe_customer_id
      };
      if (paid) {
        issues.push(issue('paid_profile_customer_missing_in_stripe', payload));
      } else {
        warnings.push(warning('free_profile_stale_customer_reference', payload));
      }
      continue;
    }

    const entitled = activeSubscriptions(subscriptions);
    if (paid && entitled.length === 0) {
      issues.push(
        issue('paid_profile_without_entitled_subscription', {
          profileId: profile.id,
          displayName: profile.display_name || null,
          stripeCustomerId: profile.stripe_customer_id,
          storedStatus: profile.subscription_status || null
        })
      );
    }

    if (!paid && entitled.length > 0) {
      issues.push(
        issue('free_profile_has_entitled_subscription', {
          profileId: profile.id,
          displayName: profile.display_name || null,
          stripeCustomerId: profile.stripe_customer_id,
          subscriptionIds: entitled.map((subscription) => subscription.id)
        })
      );
    }

    auditStoredSubscription(profile, subscriptions, issues);
  }

  const endpointList = await stripe.webhookEndpoints.list({ limit: 100 });
  const webhook = auditWebhookEndpoints(
    endpointList.data || [],
    canonicalWebhookUrl,
    issues,
    warnings
  );

  return {
    ok: issues.length === 0,
    issues,
    warnings,
    summary: {
      profileCount: profiles.length,
      issueCount: issues.length,
      warningCount: warnings.length,
      canonicalWebhookCount: webhook.exact.length,
      legacyWebhookCount: webhook.legacy.length
    }
  };
}
