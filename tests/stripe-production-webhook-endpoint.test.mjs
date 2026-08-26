import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ensureWebhookEndpoint,
  finalizeWebhookRotation,
  inspectWebhookEndpoint,
  requiredWebhookEvents
} from '../scripts/stripe-production-webhook-endpoint.mjs';

const webhookUrl = 'https://novelrise.vercel.app/api/stripe-webhook';

function liveEndpoint(id, extra = {}) {
  return {
    id,
    url: webhookUrl,
    livemode: true,
    ...extra
  };
}

test('existing webhook is updated without rotation by default', async () => {
  const calls = [];
  const existing = liveEndpoint('we_old');
  const stripe = {
    webhookEndpoints: {
      async update(id, payload) {
        calls.push(['update', id, payload]);
        return liveEndpoint(id);
      },
      async create() {
        calls.push(['create']);
        throw new Error('create should not be called');
      },
      async del(id) {
        calls.push(['delete', id]);
        throw new Error('delete should not be called');
      }
    }
  };

  const result = await ensureWebhookEndpoint({
    stripe,
    webhookUrl,
    existingEndpoint: existing,
    rotateWebhookSecret: false
  });

  assert.deepEqual(result, {
    endpointId: 'we_old',
    previousEndpointId: null,
    secret: null,
    rotated: false
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'update');
  assert.equal(calls[0][1], 'we_old');
  assert.deepEqual(calls[0][2].enabled_events, requiredWebhookEvents);
});

test('rotation prepares a replacement while keeping the previous endpoint until deployment succeeds', async () => {
  const calls = [];
  const existing = liveEndpoint('we_old');
  const stripe = {
    webhookEndpoints: {
      async create(payload) {
        calls.push(['create', payload]);
        return liveEndpoint('we_new', { secret: 'whsec_replacement' });
      },
      async del(id) {
        calls.push(['delete', id]);
        throw new Error('delete should not be called during prepare');
      }
    }
  };

  const result = await ensureWebhookEndpoint({
    stripe,
    webhookUrl,
    existingEndpoint: existing,
    rotateWebhookSecret: true
  });

  assert.deepEqual(result, {
    endpointId: 'we_new',
    previousEndpointId: 'we_old',
    secret: 'whsec_replacement',
    rotated: true
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'create');
  assert.equal(calls[0][1].url, webhookUrl);
  assert.deepEqual(calls[0][1].enabled_events, requiredWebhookEvents);
});

test('rotation finalization removes only the previous endpoint after deployment', async () => {
  const calls = [];
  const stripe = {
    webhookEndpoints: {
      async del(id) {
        calls.push(id);
        return { id, deleted: true };
      }
    }
  };

  const removed = await finalizeWebhookRotation({
    stripe,
    previousEndpointId: 'we_old',
    currentEndpointId: 'we_new'
  });

  assert.equal(removed, true);
  assert.deepEqual(calls, ['we_old']);
});

test('rotation finalization fails without deleting the replacement when old endpoint deletion fails', async () => {
  const calls = [];
  const stripe = {
    webhookEndpoints: {
      async del(id) {
        calls.push(id);
        throw new Error('cannot delete old endpoint');
      }
    }
  };

  await assert.rejects(
    finalizeWebhookRotation({
      stripe,
      previousEndpointId: 'we_old',
      currentEndpointId: 'we_new'
    }),
    /cannot delete old endpoint/
  );

  assert.deepEqual(calls, ['we_old']);
});

test('rotation mode allows repair when Vercel has no existing webhook secret', async () => {
  const existing = liveEndpoint('we_old');
  const stripe = {
    webhookEndpoints: {
      async list() {
        return { data: [existing] };
      }
    }
  };

  const result = await inspectWebhookEndpoint({
    stripe,
    webhookUrl,
    hasExistingWebhookSecret: false,
    rotateWebhookSecret: true
  });

  assert.equal(result, existing);
});

test('multiple matching webhook endpoints fail closed', async () => {
  const stripe = {
    webhookEndpoints: {
      async list() {
        return { data: [liveEndpoint('we_one'), liveEndpoint('we_two')] };
      }
    }
  };

  await assert.rejects(
    inspectWebhookEndpoint({
      stripe,
      webhookUrl,
      hasExistingWebhookSecret: true,
      rotateWebhookSecret: true
    }),
    /Multiple Stripe webhook endpoints target/
  );
});
