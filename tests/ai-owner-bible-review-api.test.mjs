import assert from 'node:assert/strict';
import test from 'node:test';

import { createOwnerBibleReviewApiHandler } from '../api/ai-owner-bible-review.js';

const env = {
  NOVELIGHT_AI_REVIEW_ENABLED: 'true',
  NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED: 'true',
  NOVELIGHT_AI_ADMIN_USER_ID: '11111111-1111-4111-8111-111111111111',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'test-only-no-real-secret',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key'
};
const token = 'test-token-for-offline-ci-only';
const headers = {
  authorization: 'Bearer ' + token,
  host: 'novelight.jp',
  'sec-fetch-site': 'same-origin'
};

function res() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
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

function setup(config = {}) {
  const calls = { clients: 0, list: 0, decide: 0, repository: 0 };
  const handler = createOwnerBibleReviewApiHandler({
    env,
    createServiceClient(url, key) {
      calls.clients += 1;
      assert.equal(url, 'https://example.supabase.co');
      assert.equal(key, env.SUPABASE_SECRET_KEY);
      return { from() {}, auth: { getUser() {} } };
    },
    createAuthorClient(_url, _key, options) {
      assert.equal(options.global.headers.Authorization, 'Bearer ' + token);
      return { rpc() {} };
    },
    createRepository() {
      calls.repository += 1;
      return {};
    },
    createWorkflow({ enabled, ownerId }) {
      assert.equal(enabled, true);
      assert.equal(ownerId, env.NOVELIGHT_AI_ADMIN_USER_ID);
      return {
        async list(args) {
          calls.list += 1;
          assert.equal(args.token, token);
          assert.equal(args.novelId, 354);
          return { novelId: 354, candidates: [] };
        },
        async decide(args) {
          calls.decide += 1;
          assert.equal(args.explicitAuthorAction, true);
          assert.equal(args.action, 'accept');
          assert.equal(args.candidateId, 44);
          assert.equal(args.expectedRevision, 2);
          return {
            novelId: 354,
            candidateId: 44,
            status: 'accepted',
            revision: 3,
            canonModified: false
          };
        }
      };
    },
    ...config
  });
  const request = (changes = {}) => ({
    method: 'GET',
    headers,
    query: { novel_id: '354' },
    ...changes
  });
  return { calls, handler, request };
}

test('owner review route stays 404 with zero privileged clients by default', async () => {
  let constructed = 0;
  const handle = createOwnerBibleReviewApiHandler({
    env: {},
    createServiceClient() {
      constructed += 1;
    }
  });
  const response = res();
  await handle({ method: 'POST', headers: {} }, response);
  assert.equal(response.statusCode, 404);
  assert.equal(constructed, 0);
  assert.equal(
    response.headers['Cache-Control'],
    'private, no-store, max-age=0'
  );
});

test('wrong method, cross-origin, and missing bearer fail before DB', async () => {
  const { handler, request, calls } = setup();
  for (const [input, status] of [
    [{ method: 'DELETE' }, 405],
    [{ headers: { ...headers, 'sec-fetch-site': 'cross-site' } }, 403],
    [{ headers: { ...headers, authorization: undefined } }, 401]
  ]) {
    const response = res();
    await handler(request(input), response);
    assert.equal(response.statusCode, status);
  }
  assert.equal(calls.clients, 0);
  assert.equal(calls.repository, 0);
});

test('GET lists only owner-scoped pending candidates through the workflow', async () => {
  const { handler, request, calls } = setup();
  const response = res();
  await handler(request(), response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { novelId: 354, candidates: [] });
  assert.equal(response.headers['X-Robots-Tag'], 'noindex, nofollow');
  assert.equal(calls.clients, 1);
  assert.equal(calls.list, 1);
});

test('POST requires same-origin and explicit request header', async () => {
  const { handler, request, calls } = setup();
  const body = {
    candidateId: 44,
    expectedRevision: 2,
    action: 'accept'
  };
  for (const h of [
    { ...headers, 'content-type': 'application/json' },
    { ...headers, origin: 'https://other.example' },
    { ...headers, origin: 'https://novelight.jp' }
  ]) {
    const response = res();
    await handler(request({ method: 'POST', headers: h, body }), response);
    assert.equal(response.statusCode, 403);
  }
  assert.equal(calls.clients, 0);
});

test('POST accepts only candidate ID, revision and explicit decision', async () => {
  const { handler, request, calls } = setup();
  const safeHeaders = {
    ...headers,
    origin: 'https://novelight.jp',
    'content-type': 'application/json',
    'x-novelight-review': '1'
  };
  for (const body of [
    { candidateId: 1, expectedRevision: 1, action: 'accept', modelText: 'x' },
    { candidateId: 1, expectedRevision: 1, action: 'promote' },
    { candidateId: 1, expectedRevision: 0, action: 'accept' },
    { candidateId: 'not-an-id', expectedRevision: 1, action: 'reject' }
  ]) {
    const response = res();
    await handler(
      request({ method: 'POST', headers: safeHeaders, body }),
      response
    );
    assert.equal(response.statusCode, 400);
  }
  const response = res();
  await handler(
    request({
      method: 'POST',
      headers: safeHeaders,
      body: { candidateId: 44, expectedRevision: 2, action: 'accept' }
    }),
    response
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.canonModified, false);
  assert.equal(calls.decide, 1);
});

test('unknown owner config never initializes privileged clients', async () => {
  let clients = 0;
  const handler = createOwnerBibleReviewApiHandler({
    env: { ...env, NOVELIGHT_AI_ADMIN_USER_ID: 'invalid' },
    createServiceClient() {
      clients += 1;
    }
  });
  const response = res();
  await handler(
    { method: 'GET', query: { novel_id: '354' }, headers },
    response
  );
  assert.equal(response.statusCode, 503);
  assert.equal(clients, 0);
});
