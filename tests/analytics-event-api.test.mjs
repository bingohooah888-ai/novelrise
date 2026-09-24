import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAnalyticsEventHandler,
  resolveAnalyticsFingerprintSecret
} from '../api/analytics-event.js';

const fingerprint = 'a'.repeat(64);

function responseState() {
  const state = { statusCode: null, body: null, headers: {} };
  return {
    state,
    res: {
      setHeader(name, value) {
        state.headers[name] = value;
      },
      status(code) {
        state.statusCode = code;
        return this;
      },
      json(body) {
        state.body = body;
        return this;
      }
    }
  };
}

function request(overrides = {}) {
  return {
    method: 'POST',
    headers: {
      host: 'novelight.example',
      origin: 'https://novelight.example'
    },
    socket: { remoteAddress: '192.0.2.10' },
    body: { action: 'visit', path: '/', source: 'direct' },
    ...overrides
  };
}

function dependencies({
  authenticated = true,
  serviceResults = [],
  authenticatedResults = []
} = {}) {
  const calls = { service: [], authenticated: [], tokens: [] };
  const nextResult = (queue, fallback) =>
    queue.length ? queue.shift() : { data: fallback, error: null };
  const serviceClient = {
    auth: {
      async getUser(token) {
        calls.tokens.push(token);
        return authenticated
          ? { data: { user: { id: 'verified-user' } }, error: null }
          : { data: { user: null }, error: { message: 'invalid token' } };
      }
    },
    async rpc(name, args) {
      calls.service.push({ name, args });
      const fallback = {
        record_acquisition_touch: 'id',
        record_beta_visit: true,
        record_reader_journey_event: true,
        record_episode_pv: true,
        record_neutral_search_impressions: 1
      }[name];
      return nextResult(serviceResults, fallback);
    }
  };
  const authenticatedClient = {
    async rpc(name, args) {
      calls.authenticated.push({ name, args });
      return nextResult(authenticatedResults, true);
    }
  };
  return {
    calls,
    handler: createAnalyticsEventHandler({
      serviceClient,
      createAuthenticatedClient(token) {
        calls.tokens.push(`client:${token}`);
        return authenticatedClient;
      },
      fingerprintRequest() {
        return fingerprint;
      }
    })
  };
}

test('analytics fingerprint secret is dedicated and has sufficient entropy', () => {
  const supabaseSecret = 's'.repeat(40);
  const fingerprintSecret = 'f'.repeat(32);

  assert.equal(
    resolveAnalyticsFingerprintSecret(fingerprintSecret, supabaseSecret),
    fingerprintSecret
  );
  assert.throws(
    () => resolveAnalyticsFingerprintSecret('', supabaseSecret),
    /unavailable or too short/u
  );
  assert.throws(
    () => resolveAnalyticsFingerprintSecret('short', supabaseSecret),
    /unavailable or too short/u
  );
  assert.throws(
    () => resolveAnalyticsFingerprintSecret(supabaseSecret, supabaseSecret),
    /purpose-specific/u
  );
});

test('public analytics endpoint is POST-only, same-origin, and non-cacheable', async () => {
  const { handler, calls } = dependencies();

  for (const req of [
    request({ method: 'GET' }),
    request({ headers: { host: 'novelight.example' } }),
    request({
      headers: {
        host: 'novelight.example',
        origin: 'https://attacker.example'
      }
    })
  ]) {
    const { res, state } = responseState();
    await handler(req, res);
    assert.ok([403, 405].includes(state.statusCode));
    assert.equal(state.headers['Cache-Control'], 'no-store, max-age=0');
  }
  assert.deepEqual(calls.service, []);
});

test('anonymous acquisition ignores client identity and uses the server fingerprint', async () => {
  const { handler, calls } = dependencies();
  const { res, state } = responseState();
  await handler(
    request({
      body: {
        action: 'acquisition',
        visitor_token: 'attacker-selected-token',
        user_id: 'attacker-selected-user',
        source: 'x',
        medium: 'social',
        landing_path: '/beta'
      }
    }),
    res
  );

  assert.equal(state.statusCode, 200);
  assert.deepEqual(calls.service, [
    {
      name: 'record_acquisition_touch',
      args: {
        p_visitor_token: fingerprint,
        p_source: 'x',
        p_medium: 'social',
        p_campaign: null,
        p_content: null,
        p_landing_path: '/beta',
        p_referrer_host: null
      }
    }
  ]);
  assert.deepEqual(calls.authenticated, []);
});

test('authenticated analytics validates bearer identity and claims server attribution', async () => {
  const { handler, calls } = dependencies();
  const headers = {
    host: 'novelight.example',
    origin: 'https://novelight.example',
    authorization: 'Bearer verified-token'
  };

  let response = responseState();
  await handler(
    request({
      headers,
      body: { action: 'visit', path: '/account', source: 'direct' }
    }),
    response.res
  );
  assert.equal(response.state.statusCode, 200);

  response = responseState();
  await handler(
    request({
      headers,
      body: { action: 'acquisition', source: 'direct' }
    }),
    response.res
  );
  assert.equal(response.state.statusCode, 200);
  assert.deepEqual(calls.tokens, [
    'verified-token',
    'client:verified-token',
    'verified-token',
    'client:verified-token'
  ]);
  assert.deepEqual(calls.authenticated, [
    {
      name: 'record_beta_visit',
      args: {
        p_visitor_token: fingerprint,
        p_path: '/account',
        p_source: 'direct'
      }
    },
    {
      name: 'claim_user_acquisition',
      args: { p_visitor_token: fingerprint }
    }
  ]);
});

test('anonymous journey, PV, and search telemetry use one server fingerprint', async () => {
  const { handler, calls } = dependencies();
  const requests = [
    {
      action: 'journey',
      event_type: 'episode_read_10s',
      novel_id: 'novel-1',
      episode_id: 'episode-1',
      source: 'x',
      visitor_token: 'client-controlled'
    },
    {
      action: 'episode-pv',
      episode_id: 'episode-1',
      visitor_token: 'another-client-token'
    },
    {
      action: 'neutral-search-impressions',
      novel_ids: ['novel-1', 'novel-2'],
      visitor_token: 'rotated-client-token'
    }
  ];

  for (const body of requests) {
    const response = responseState();
    await handler(request({ body }), response.res);
    assert.equal(response.state.statusCode, 200);
  }

  assert.deepEqual(calls.service, [
    {
      name: 'record_reader_journey_event',
      args: {
        p_event_type: 'episode_read_10s',
        p_novel_id: 'novel-1',
        p_episode_id: 'episode-1',
        p_visitor_token: fingerprint,
        p_source: 'x'
      }
    },
    {
      name: 'record_episode_pv',
      args: {
        p_episode_id: 'episode-1',
        p_visitor_token: fingerprint
      }
    },
    {
      name: 'record_neutral_search_impressions',
      args: {
        p_novel_ids: ['novel-1', 'novel-2'],
        p_visitor_token: fingerprint
      }
    }
  ]);
});

test('invalid bearer is rejected and database rate limits stay enumeration-neutral', async () => {
  let setup = dependencies({ authenticated: false });
  let response = responseState();
  await setup.handler(
    request({
      headers: {
        host: 'novelight.example',
        origin: 'https://novelight.example',
        authorization: 'Bearer invalid-token'
      }
    }),
    response.res
  );
  assert.equal(response.state.statusCode, 401);
  assert.deepEqual(setup.calls.service, []);

  setup = dependencies({
    serviceResults: [
      {
        data: null,
        error: { code: 'P0001', message: 'Too many acquisition events' }
      }
    ]
  });
  response = responseState();
  await setup.handler(
    request({ body: { action: 'acquisition', source: 'direct' } }),
    response.res
  );
  assert.equal(response.state.statusCode, 200);
  assert.deepEqual(response.state.body, { accepted: false });
});
