import assert from 'node:assert/strict';
import test from 'node:test';

import { createOwnerBibleAnalyzeApiHandler } from '../api/ai-owner-bible-analyze.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'synthetic-test-bearer-no-real-credentials';
const ENV = {
  NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED: 'true',
  NOVELIGHT_AI_REVIEW_ENABLED: 'true',
  NOVELIGHT_AI_MODEL_TRIAL_ENABLED: 'true',
  NOVELIGHT_AI_EXTERNAL_PROCESSING_APPROVED: 'true',
  NOVELIGHT_AI_ENABLED: 'true',
  NOVELIGHT_AI_ADMIN_USER_ID: OWNER,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'synthetic-not-a-secret',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key'
};
const HEADERS = {
  authorization: 'Bearer ' + TOKEN,
  host: 'novelight.jp',
  origin: 'https://novelight.jp',
  'content-type': 'application/json',
  'x-novelight-ai-trial': '1',
  'sec-fetch-site': 'same-origin'
};

function response() {
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
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function fixture({ env = ENV, actor = OWNER, stage = null } = {}) {
  const calls = { service: 0, auth: 0, build: 0, stage: 0 };
  const handler = createOwnerBibleAnalyzeApiHandler({
    env,
    createServiceClient(url, secret) {
      calls.service += 1;
      assert.equal(url, 'https://example.supabase.co');
      assert.equal(secret, ENV.SUPABASE_SECRET_KEY);
      return {
        auth: {
          async getUser(token) {
            calls.auth += 1;
            assert.equal(token, TOKEN);
            return { data: { user: { id: actor } }, error: null };
          }
        }
      };
    },
    createTrialBridge({ ownerId, serviceClient }) {
      calls.build += 1;
      assert.equal(ownerId, OWNER);
      assert.equal(typeof serviceClient.auth.getUser, 'function');
      return {
        async stage(args) {
          calls.stage += 1;
          assert.equal(args.token, TOKEN);
          assert.deepEqual(
            { novelId: args.novelId, episodeId: args.episodeId, chunkIndex: args.chunkIndex },
            { novelId: 41, episodeId: 11, chunkIndex: 0 }
          );
          return stage
            ? stage(args)
            : {
                novelId: 41,
                stagedCount: 1,
                requiresAuthorReview: true,
                privateModelText: 'should never be returned'
              };
        }
      };
    }
  });
  const req = (options = {}) => ({
    method: 'POST',
    headers: { ...HEADERS },
    body: { novelId: 41, episodeId: 11, chunkIndex: 0 },
    ...options
  });
  return { handler, req, calls };
}

test('trial API is hidden by default without constructing privileged clients', async () => {
  let clients = 0;
  const handler = createOwnerBibleAnalyzeApiHandler({
    env: {},
    createServiceClient() {
      clients += 1;
    }
  });
  const res = response();
  await handler({ method: 'POST', headers: HEADERS }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(clients, 0);
  assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0');
  assert.equal(res.headers['X-Robots-Tag'], 'noindex, nofollow');
});

test('every independent trial and external-processing flag is required', async () => {
  for (const name of [
    'NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED',
    'NOVELIGHT_AI_REVIEW_ENABLED',
    'NOVELIGHT_AI_MODEL_TRIAL_ENABLED',
    'NOVELIGHT_AI_EXTERNAL_PROCESSING_APPROVED',
    'NOVELIGHT_AI_ENABLED'
  ]) {
    const { handler, req, calls } = fixture({
      env: { ...ENV, [name]: 'false' }
    });
    const res = response();
    await handler(req(), res);
    assert.equal(res.statusCode, 404);
    assert.equal(calls.service, 0);
    assert.equal(calls.stage, 0);
  }
});

test('method, Origin, CSRF header and content type reject before Auth', async () => {
  const { handler, req, calls } = fixture();
  const invalid = [
    [{ method: 'GET' }, 405],
    [{ headers: { ...HEADERS, origin: undefined } }, 403],
    [{ headers: { ...HEADERS, origin: 'https://attacker.example' } }, 403],
    [{ headers: { ...HEADERS, 'sec-fetch-site': 'cross-site' } }, 403],
    [{ headers: { ...HEADERS, 'x-novelight-ai-trial': undefined } }, 403],
    [{ headers: { ...HEADERS, 'content-type': 'text/plain' } }, 403],
    [{ headers: { ...HEADERS, authorization: undefined } }, 401]
  ];
  for (const [options, expected] of invalid) {
    const res = response();
    await handler(req(options), res);
    assert.equal(res.statusCode, expected);
  }
  assert.equal(calls.auth, 0);
  assert.equal(calls.stage, 0);
});

test('only bounded chapter ID and chunk index are accepted, never provider text or consent', async () => {
  const { handler, req, calls } = fixture();
  for (const body of [
    {},
    { novelId: 41, episodeId: 11, modelText: 'untrusted' },
    { novelId: 41, episodeId: 11, consent: true },
    { novelId: 41, episodeId: 11, userId: OWNER },
    { novelId: -1, episodeId: 11 },
    { novelId: 41, episodeId: 'bad' },
    { novelId: 41, episodeId: 11, chunkIndex: -1 },
    { novelId: 41, episodeId: 11, chunkIndex: 64 },
    { novelId: 41, episodeId: 11, chunkIndex: 1.5 }
  ]) {
    const res = response();
    await handler(req({ body }), res);
    assert.equal(res.statusCode, 400);
  }
  const oversized = response();
  await handler(
    req({ body: { novelId: 41, episodeId: 11, text: 'x'.repeat(1000) } }),
    oversized
  );
  assert.equal(oversized.statusCode, 413);
  assert.equal(calls.auth, 0);
  assert.equal(calls.stage, 0);
});

test('bad admin configuration or missing server runtime fails without model calls', async () => {
  const misconfigured = fixture({
    env: { ...ENV, NOVELIGHT_AI_ADMIN_USER_ID: 'invalid' }
  });
  const rejected = response();
  await misconfigured.handler(misconfigured.req(), rejected);
  assert.equal(rejected.statusCode, 503);
  assert.equal(misconfigured.calls.service, 0);

  let constructed = 0;
  const handler = createOwnerBibleAnalyzeApiHandler({
    env: ENV,
    createServiceClient() {
      constructed += 1;
    }
  });
  const missing = response();
  await handler(
    {
      method: 'POST',
      headers: HEADERS,
      body: { novelId: 41, episodeId: 11 }
    },
    missing
  );
  assert.equal(missing.statusCode, 503);
  assert.equal(constructed, 0);
});

test('non-owner cannot construct trial bridge or call a provider', async () => {
  const { handler, req, calls } = fixture({ actor: OTHER });
  const res = response();
  await handler(req(), res);
  assert.equal(res.statusCode, 404);
  assert.equal(calls.service, 1);
  assert.equal(calls.auth, 1);
  assert.equal(calls.build, 0);
  assert.equal(calls.stage, 0);
});

test('explicit owner trial returns only bounded review metadata', async () => {
  const { handler, req, calls } = fixture();
  const res = response();
  await handler(req(), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    novelId: 41,
    stagedCount: 1,
    requiresAuthorReview: true
  });
  assert.equal(calls.stage, 1);
  assert.ok(!JSON.stringify(res.body).includes(TOKEN));
  assert.ok(!JSON.stringify(res.body).includes('privateModelText'));
});

test('model, budget and revision errors never echo sensitive details', async () => {
  for (const [code, status] of [
    ['AI_BUDGET_DENIED', 429],
    ['AI_BIBLE_MODEL_BRIDGE_DENIED', 404],
    ['AI_BIBLE_INFERENCE_INVALID', 409],
    ['provider-secret-private-error', 503]
  ]) {
    const { handler, req } = fixture({
      stage() {
        throw new Error(code);
      }
    });
    const res = response();
    await handler(req(), res);
    assert.equal(res.statusCode, status);
    assert.ok(!JSON.stringify(res.body).includes(code === 'provider-secret-private-error' ? code : TOKEN));
  }
});

test('untrusted runtime output is rejected instead of forwarded to browser', async () => {
  const { handler, req } = fixture({
    stage() {
      return {
        novelId: 41,
        stagedCount: 500,
        requiresAuthorReview: true,
        privateModelText: 'never leak'
      };
    }
  });
  const res = response();
  await handler(req(), res);
  assert.equal(res.statusCode, 503);
  assert.ok(!JSON.stringify(res.body).includes('never leak'));
});
