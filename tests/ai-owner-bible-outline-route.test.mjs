import assert from 'node:assert/strict';
import test from 'node:test';

import { createOwnerBibleOutlineApiHandler } from '../api/ai-owner-bible-outline.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'synthetic-owner-bearer-00000000';
const ENV = {
  NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED: 'true',
  NOVELIGHT_AI_OWNER_OUTLINE_ENABLED: 'true',
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
  const handler = createOwnerBibleOutlineApiHandler({
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
    createOwnerBibleOutlineApiHandler({
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

test('invalid requests never touch the privileged client', async () => {
  let created = 0;
  const handler = createOwnerBibleOutlineApiHandler({
    enabled: true,
    env: ENV,
    lookupOneSession: async () => true,
    createServiceClient() {
      created += 1;
      return fakeService();
    }
  });
  for (const [req, statusCode] of [
    [request({ method: 'POST' }), 405],
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

test('explicit scoped capabilities use the existing wiring once', async () => {
  let created = 0;
  let wired = 0;
  const handler = createOwnerBibleOutlineApiHandler({
    enabled: true,
    env: ENV,
    createServiceClient(url, secret, options) {
      created += 1;
      assert.equal(url, ENV.SUPABASE_URL);
      assert.equal(secret, ENV.SUPABASE_SECRET_KEY);
      assert.deepEqual(options.auth, {
        autoRefreshToken: false,
        persistSession: false
      });
      return fakeService();
    },
    createAuthorClient() {},
    lookupOneSession: async () => true,
    nowEpochSeconds: () => 1800000000,
    createWiring(options) {
      wired += 1;
      assert.equal(options.enabled, true);
      assert.equal(typeof options.lookupOneSession, 'function');
      assert.equal(options.env, ENV);
      return async (_req, res) =>
        res.status(200).json({
          novelId: 23,
          aiGenerated: false,
          outlineRows: []
        });
    }
  });
  for (let i = 0; i < 2; i++) {
    const res = response();
    await handler(request(), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      novelId: 23,
      aiGenerated: false,
      outlineRows: []
    });
  }
  assert.equal(created, 1);
  assert.equal(wired, 1);
});
