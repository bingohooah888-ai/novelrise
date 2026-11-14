import assert from 'node:assert/strict';
import test from 'node:test';

import { createOwnerBibleReviewStateApiHandler } from '../api/ai-owner-bible-review-state.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'synthetic-owner-review-bearer-not-live';
const ENV = {
  NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED: 'true',
  NOVELIGHT_AI_OWNER_REVIEW_STATE_ENABLED: 'true',
  NOVELIGHT_AI_ADMIN_USER_ID: OWNER,
  SUPABASE_URL: 'https://mock.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_review',
  SUPABASE_SECRET_KEY: 'synthetic-not-a-secret'
};

function response() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(k, v) {
      this.headers[k] = v;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function request(overrides = {}) {
  return {
    method: 'GET',
    query: { novel_id: '25' },
    headers: {
      host: 'novelight.test',
      origin: 'https://novelight.test',
      'sec-fetch-site': 'same-origin',
      authorization: 'Bearer ' + TOKEN
    },
    ...overrides
  };
}

test('default export state returns 404 without privileged client construction', async () => {
  let created = 0;
  const handler = createOwnerBibleReviewStateApiHandler({
    env: ENV,
    createServiceClient() {
      created++;
      return {};
    }
  });
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'NOT_FOUND' });
  assert.equal(created, 0);
  assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0');
});

test('active flags never replace a trusted private session observer', async () => {
  let created = 0;
  const make = (options) =>
    createOwnerBibleReviewStateApiHandler({
      env: ENV,
      enabled: true,
      createServiceClient() {
        created++;
        return {};
      },
      ...options
    });
  const res = response();
  await make()(request(), res);
  assert.equal(res.statusCode, 503);
  const other = response();
  await make({
    lookupOneSession: async () => true,
    env: { ...ENV, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_not_public' }
  })(request(), other);
  assert.equal(other.statusCode, 503);
  assert.equal(created, 0);
});

test('invalid method, origin, bearer, and novel ID deny before privileged IO', async () => {
  let created = 0;
  const handler = createOwnerBibleReviewStateApiHandler({
    env: ENV,
    enabled: true,
    lookupOneSession: async () => true,
    createServiceClient() {
      created++;
      return {};
    }
  });
  for (const [req, expected] of [
    [request({ method: 'DELETE' }), 405],
    [
      request({ headers: { ...request().headers, origin: 'https://evil.test' } }),
      403
    ],
    [
      request({ headers: { ...request().headers, authorization: 'Bearer short' } }),
      401
    ],
    [request({ query: { novel_id: '25bad' } }), 400]
  ]) {
    const res = response();
    await handler(req, res);
    assert.equal(res.statusCode, expected);
  }
  assert.equal(created, 0);
});
