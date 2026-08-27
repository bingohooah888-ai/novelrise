export const requiredWebhookEvents = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.finalization_failed'
];

export const managedWebhookDescription =
  'NOVELIGHT production subscription synchronization';

function webhookPayload(webhookUrl) {
  return {
    url: webhookUrl,
    description: managedWebhookDescription,
    enabled_events: requiredWebhookEvents
  };
}

function normalizePathname(pathname) {
  return String(pathname || '').replace(/\/+$/, '') || '/';
}

function endpointIsEnabled(endpoint) {
  return !endpoint?.status || endpoint.status === 'enabled';
}

export function isLegacyNovelightWebhookEndpoint(endpoint, webhookUrl) {
  if (!endpoint?.url || endpoint.url === webhookUrl) return false;
  if (!endpointIsEnabled(endpoint)) return false;

  let endpointUrl;
  let canonicalUrl;
  try {
    endpointUrl = new URL(endpoint.url);
    canonicalUrl = new URL(webhookUrl);
  } catch {
    return false;
  }

  if (
    normalizePathname(endpointUrl.pathname) !==
    normalizePathname(canonicalUrl.pathname)
  ) {
    return false;
  }

  if (endpoint.description === managedWebhookDescription) return true;

  const host = endpointUrl.hostname.toLowerCase();
  return host.endsWith('.vercel.app') && host.startsWith('novelrise');
}

async function createValidatedEndpoint(stripe, webhookUrl) {
  const endpoint = await stripe.webhookEndpoints.create(webhookPayload(webhookUrl));

  if (endpoint.livemode && endpoint.secret) {
    return endpoint;
  }

  if (endpoint.id) {
    try {
      await stripe.webhookEndpoints.del(endpoint.id);
    } catch (cleanupError) {
      throw new AggregateError(
        [cleanupError],
        'Stripe returned an invalid replacement webhook endpoint and it could not be cleaned up'
      );
    }
  }

  throw new Error('Stripe did not return a live webhook signing secret');
}

export async function inspectWebhookEndpoint({
  stripe,
  webhookUrl,
  hasExistingWebhookSecret,
  rotateWebhookSecret
}) {
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const matching = endpoints.data.filter((endpoint) => endpoint.url === webhookUrl);

  if (matching.length > 1) {
    throw new Error(`Multiple Stripe webhook endpoints target ${webhookUrl}`);
  }

  if (matching.length === 0) {
    return null;
  }

  const endpoint = matching[0];
  if (!endpoint.livemode) {
    throw new Error('Existing NOVELIGHT webhook endpoint is not in live mode');
  }

  if (!rotateWebhookSecret && !hasExistingWebhookSecret) {
    throw new Error(
      'A live NOVELIGHT webhook endpoint already exists, but Vercel has no STRIPE_WEBHOOK_SECRET. Run the approved webhook-secret rotation repair before continuing.'
    );
  }

  return endpoint;
}

export async function findLegacyWebhookEndpoints({ stripe, webhookUrl }) {
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  return endpoints.data.filter((endpoint) =>
    isLegacyNovelightWebhookEndpoint(endpoint, webhookUrl)
  );
}

export async function ensureWebhookEndpoint({
  stripe,
  webhookUrl,
  existingEndpoint,
  rotateWebhookSecret
}) {
  if (existingEndpoint && !rotateWebhookSecret) {
    const endpoint = await stripe.webhookEndpoints.update(
      existingEndpoint.id,
      webhookPayload(webhookUrl)
    );

    if (!endpoint.livemode) {
      throw new Error('Updated NOVELIGHT webhook endpoint is not in live mode');
    }

    return {
      endpointId: endpoint.id,
      previousEndpointId: null,
      secret: null,
      rotated: false
    };
  }

  const replacement = await createValidatedEndpoint(stripe, webhookUrl);

  return {
    endpointId: replacement.id,
    previousEndpointId: existingEndpoint?.id ?? null,
    secret: replacement.secret,
    rotated: Boolean(existingEndpoint)
  };
}

export async function finalizeWebhookRotation({
  stripe,
  previousEndpointId,
  currentEndpointId
}) {
  if (!previousEndpointId) {
    return false;
  }

  if (!currentEndpointId || previousEndpointId === currentEndpointId) {
    throw new Error('Webhook rotation endpoint IDs are invalid');
  }

  await stripe.webhookEndpoints.del(previousEndpointId);
  return true;
}

export async function removeVerifiedLegacyWebhookEndpoints({
  stripe,
  webhookUrl,
  legacyEndpointIds,
  currentEndpointId
}) {
  const requestedIds = [...new Set(legacyEndpointIds || [])];
  if (requestedIds.length === 0) return [];

  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const byId = new Map(endpoints.data.map((endpoint) => [endpoint.id, endpoint]));
  const removed = [];

  for (const endpointId of requestedIds) {
    if (endpointId === currentEndpointId) {
      throw new Error('Refusing to remove the current NOVELIGHT webhook endpoint');
    }

    const endpoint = byId.get(endpointId);
    if (!endpoint) continue;

    if (!isLegacyNovelightWebhookEndpoint(endpoint, webhookUrl)) {
      throw new Error(
        `Refusing to delete webhook endpoint ${endpointId}: it no longer matches the verified legacy NOVELIGHT endpoint criteria`
      );
    }

    await stripe.webhookEndpoints.del(endpointId);
    removed.push(endpointId);
  }

  return removed;
}
