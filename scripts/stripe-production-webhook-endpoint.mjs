export const requiredWebhookEvents = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.finalization_failed'
];

function webhookPayload(webhookUrl) {
  return {
    url: webhookUrl,
    description: 'NOVELIGHT production subscription synchronization',
    enabled_events: requiredWebhookEvents
  };
}

async function createValidatedEndpoint(stripe, webhookUrl) {
  const endpoint = await stripe.webhookEndpoints.create(webhookPayload(webhookUrl));

  if (!endpoint.livemode || !endpoint.secret) {
    throw new Error('Stripe did not return a live webhook signing secret');
  }

  return endpoint;
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
      secret: null,
      rotated: false
    };
  }

  const replacement = await createValidatedEndpoint(stripe, webhookUrl);

  if (!existingEndpoint) {
    return {
      endpointId: replacement.id,
      secret: replacement.secret,
      rotated: false
    };
  }

  try {
    await stripe.webhookEndpoints.del(existingEndpoint.id);
  } catch (deleteError) {
    try {
      await stripe.webhookEndpoints.del(replacement.id);
    } catch (cleanupError) {
      throw new AggregateError(
        [deleteError, cleanupError],
        'Webhook secret rotation failed and the replacement endpoint could not be cleaned up'
      );
    }

    throw new Error(
      'Webhook secret rotation failed while deleting the previous endpoint; the replacement endpoint was removed and the previous endpoint was preserved',
      { cause: deleteError }
    );
  }

  return {
    endpointId: replacement.id,
    secret: replacement.secret,
    rotated: true
  };
}
