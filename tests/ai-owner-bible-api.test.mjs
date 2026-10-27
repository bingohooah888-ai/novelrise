import assert from 'node:assert/strict';
import test from 'node:test';

import { createOwnerNovelBibleApiHandler } from '../api/ai-owner-novel-bible.js';

function reply() {
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
    json(value) {
      this.body = value;
      return this;
    }
  };
}

test('API route defaults to 404 without constructing any privileged client', async () => {
  let constructed = 0;
  const handle = createOwnerNovelBibleApiHandler({
    env: {},
    createServiceClient() {
      constructed += 1;
      throw new Error('service client must not be created');
    }
  });
  const res = reply();
  await handle({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(constructed, 0);
  assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0');
  assert.equal(res.headers['X-Robots-Tag'], 'noindex, nofollow');
});

test('explicit flag still fails closed without owner identity and service config', async () => {
  let created = 0;
  const handle = createOwnerNovelBibleApiHandler({
    env: { NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED: 'true' },
    createServiceClient() {
      created += 1;
    }
  });
  const res = reply();
  await handle({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(created, 0);
});

test('disallowed verbs stay read-only without service side effects', async () => {
  const handle = createOwnerNovelBibleApiHandler({
    env: { NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED: 'true' },
    createServiceClient() {
      throw new Error('must not initialize service client on POST');
    }
  });
  const res = reply();
  await handle({ method: 'POST', headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET');
});

test('an enabled but unauthorized caller is rejected by the owner-only boundary', async () => {
  let constructed = 0;
  const serviceClient = {
    auth: {
      async getUser() {
        return { data: { user: null }, error: { message: 'unauthorized' } };
      }
    },
    from() {
      throw new Error('private data must not be queried');
    },
    rpc() {
      throw new Error('model calls forbidden');
    }
  };
  const handle = createOwnerNovelBibleApiHandler({
    env: {
      NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED: 'true',
      NOVELIGHT_AI_ADMIN_USER_ID: '11111111-1111-4111-8111-111111111111',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SECRET_KEY: 'fake-test-only',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key'
    },
    createServiceClient() {
      constructed += 1;
      return serviceClient;
    }
  });
  const res = reply();
  await handle({ method: 'GET', headers: { host: 'novelight.jp' } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(constructed, 1);
});

test('incomplete trial settings never initialize privileged clients', async () => {
  const complete = {
    NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED: 'true',
    NOVELIGHT_AI_ADMIN_USER_ID: '11111111-1111-4111-8111-111111111111',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SECRET_KEY: 'fake-test-only',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key'
  };
  for (const changes of [
    { SUPABASE_PUBLISHABLE_KEY: undefined },
    { SUPABASE_PUBLISHABLE_KEY: 'sb_secret_not_public' },
    { NOVELIGHT_AI_ADMIN_USER_ID: undefined },
    { NOVELIGHT_AI_ADMIN_USER_ID: 'invalid-owner-uuid' },
    { SUPABASE_URL: 'https://untrusted.example' },
    { SUPABASE_SECRET_KEY: undefined }
  ]) {
    let created = 0;
    const handler = createOwnerNovelBibleApiHandler({
      env: { ...complete, ...changes },
      createServiceClient() {
        created += 1;
        throw new Error(
          'incomplete preview must not initialize service client'
        );
      }
    });
    const res = reply();
    await handler({ method: 'GET', headers: {} }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(created, 0);
    assert.deepEqual(res.body, { error: 'AI_PREVIEW_UNAVAILABLE' });
  }
});
