import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ensureWebhookEndpoint,
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
    secret: null,
    rotated: false
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'update');
  assert.equal(calls[0][1], 'we_old');
  assert.deepEqual(calls[0][2].enabled_events, requiredWebhookEvents);
});

test('rotation creates a replacement, deletes the old endpoint, and returns the new secret', async () => {
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
        return { id, deleted: true };
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
    secret: 'whsec_replacement',
    rotated: true
  });
  assert.deepEqual(
    calls.map((call) => [call[0], call[1]?.id ?? call[1]]),
    [
      ['create', webhookUrl],
      ['delete', 'we_old']
    ]
  );
  assert.deepEqual(calls[0][1].enabled_events, requiredWebhookEvents);
});

test('rotation cleans up the replacement and fails closed when old endpoint deletion fails', async () => {
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
        if (id === 'we_old') {
          throw new Error('cannot delete old endpoint');
        }
        return { id, deleted: true };
      }
    }
  };

  await assert.rejects(
    ensureWebhookEndpoint({
      stripe,
      webhookUrl,
      existingEndpoint: existing,
      rotateWebhookSecret: true
    }),
    /replacement endpoint was removed and the previous endpoint was preserved/
  );

  assert.deepEqual(
    calls.map((call) => [call[0], call[1]?.id ?? call[1]]),
    [
      ['create', webhookUrl],
      ['delete', 'we_old'],
      ['delete', 'we_new']
    ]
  );
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
