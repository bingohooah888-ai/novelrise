import assert from 'node:assert/strict';
import test from 'node:test';

import { createOwnerBibleReviewStateApiHandler } from '../api/ai-owner-bible-review-state.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'synthetic-owner-bearer-00000000';
const ENV = {
  NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED: 'true',
  NOVELIGHT_AI_OWNER_REVIEW_STATE_ENABLED: 'true',
  NOVELIGHT_AI_ADMIN_USER_ID: OWNER,
  SUPABASE_URL: 'https://mock.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_route',
  SUPABASE_SECRET_KEY: 'synthetic-test-secret-not-real'
};

function response() {
  return {
    headers: {},
    statusCode: 0,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function request(overrides = {}) {
  return {
    method: 'GET',
    headers: {
      host: 'novelight.test',
      origin: 'https://novelight.test',
      'sec-fetch-site': 'same-origin',
      authorization: 'Bearer ' + TOKEN
    },
    query: { novel_id: '23' },
    ...overrides
  };
}

function fakeService() {
  return {
    auth: { getUser() {}, getClaims() {} },
    from() {},
    rpc() {}
  };
}

test('default disabled route is 404 even with enabled flags', async () => {
  let created = 0;
  const handler = createOwnerBibleReviewStateApiHandler({
    env: ENV,
    createServiceClient() {
      created += 1;
      return fakeService();
    }
  });
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'NOT_FOUND' });
  assert.equal(created, 0);
  assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0');
  assert.equal(res.headers['X-Robots-Tag'], 'noindex, nofollow');
});

test('missing session or invalid config blocks client setup', async () => {
  let created = 0;
  const make = (options) =>
    createOwnerBibleReviewStateApiHandler({
      enabled: true,
      env: ENV,
      createServiceClient() {
        created += 1;
        return fakeService();
      },
      ...options
    });
  const res = response();
  await make()(request(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(created, 0);
  const invalid = response();
  await make({
    lookupOneSession: async () => true,
    env: { ...ENV, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_never_public' }
  })(request(), invalid);
  assert.equal(invalid.statusCode, 503);
  assert.equal(created, 0);
});

test('restricted RPC mode is Staging-pinned and never enables the default route', async () => {
  let created = 0;
  const handler = (env) =>
    createOwnerBibleReviewStateApiHandler({
      enabled: true,
      env,
      sessionLookupMode: 'restricted_rpc',
      createServiceClient() {
        created += 1;
        return fakeService();
      }
    });
  const wrong = response();
  await handler(ENV)(request(), wrong);
  assert.equal(wrong.statusCode, 503);
  assert.equal(created, 0);

  const staging = {
    ...ENV,
    SUPABASE_URL: 'https://wmlzjgvxgoyrovdhbqbg.supabase.co'
  };
  const result = response();
  await handler(staging)(request(), result);
  assert.notEqual(result.statusCode, 200);
  assert.equal(created, 1);
});

test('invalid requests never touch the privileged client', async () => {
  let created = 0;
  const handler = createOwnerBibleReviewStateApiHandler({
    enabled: true,
    env: ENV,
    lookupOneSession: async () => true,
    createServiceClient() {
      created += 1;
      return fakeService();
    }
  });
  for (const [req, statusCode] of [
    [request({ method: 'DELETE' }), 405],
    [
      request({
        headers: { ...request().headers, origin: 'https://evil.test' }
      }),
      403
    ],
    [
      request({
        headers: { ...request().headers, authorization: 'Bearer short' }
      }),
      401
    ]
  ]) {
    const res = response();
    await handler(req, res);
    assert.equal(res.statusCode, statusCode);
  }
  assert.equal(created, 0);
});
