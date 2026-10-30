import assert from 'node:assert/strict';
import test from 'node:test';

import { createOwnerNovelBibleAuthorClientFactory } from '../api/_lib/ai/owner-novel-bible-author-client.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'synthetic-owner-token-not-a-real-jwt';
const URL = 'https://example.supabase.co';
const PUBLIC_KEY = 'sb_publishable_offline_test_public_key';
const CONFIG = { url: URL, key: PUBLIC_KEY, id: OWNER };

function fixture({ subject = OWNER, authError = null, factoryError = null } = {}) {
  const calls = [];
  const createClientImpl = (url, key, options) => {
    calls.push({ action: 'createClient', url, key, options });
    return {
      auth: {
        async getUser(token) {
          calls.push({ action: 'getUser', token });
          if (factoryError) throw factoryError;
          return {
            data: { user: { id: subject } },
            error: authError
          };
        }
      },
      async rpc(name) {
        calls.push({ action: 'rpc', name });
        return { data: [], error: null };
      }
    };
  };
  return {
    calls,
    make: (config = CONFIG) =>
      createOwnerNovelBibleAuthorClientFactory({ config, createClientImpl })
  };
}

test('defaults to no client when configuration is missing', () => {
  assert.throws(
    () => createOwnerNovelBibleAuthorClientFactory(),
    /AI_TRIAL_AUTHOR_CLIENT_UNAVAILABLE/u
  );
});

test('rejects secret keys and foreign or malformed URLs before client creation', () => {
  const { make, calls } = fixture();
  const bad = [
    { ...CONFIG, key: 'sb_secret_not_for_author_rpc' },
    { ...CONFIG, url: 'https://example.invalid' },
    { ...CONFIG, url: 'http://example.supabase.co' },
    { ...CONFIG, key: 'not-a-publishable-key' }
  ];
  for (const config of bad) {
    assert.throws(() => make(config), /AI_TRIAL_AUTHOR_CLIENT_UNAVAILABLE/u);
  }
  assert.equal(calls.length, 0);
});

test('configured trial owner is checked against caller identity', async () => {
  const { make, calls } = fixture();
  const foreignFactory = make({ ...CONFIG, id: OTHER });
  await assert.rejects(
    foreignFactory({ actorId: OWNER, token: TOKEN }),
    /AI_TRIAL_AUTHOR_CLIENT_DENIED/u
  );
  assert.equal(calls.length, 0);
});

test('rejects bad bearer or caller identity before creating a client', async () => {
  const { make, calls } = fixture();
  const createAuthorClient = make();
  for (const request of [
    { actorId: OTHER, token: TOKEN },
    { actorId: OWNER, token: 'short' },
    { actorId: OWNER, token: 'synthetic token with whitespace' },
    { actorId: OWNER, token: TOKEN + '\n' },
    { actorId: OWNER },
    { token: TOKEN }
  ]) {
    await assert.rejects(
      createAuthorClient(request),
      /AI_TRIAL_AUTHOR_CLIENT_DENIED/u
    );
  }
  assert.equal(calls.length, 0);
});

test('builds owner-JWT author RPC client from publishable key only', async () => {
  const { make, calls } = fixture();
  const result = await make()({ actorId: OWNER, token: TOKEN });
  assert.equal(typeof result.rpc, 'function');
  assert.deepEqual(
    calls.map((item) => item.action),
    ['createClient', 'getUser']
  );
  assert.equal(calls[0].url, URL);
  assert.equal(calls[0].key, PUBLIC_KEY);
  assert.deepEqual(calls[0].options.auth, {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  });
  assert.equal(calls[0].options.global.headers.Authorization, 'Bearer ' + TOKEN);
  assert.equal(calls[1].token, TOKEN);
});

test('other user and Auth errors deny access without exposing credentials', async () => {
  for (const options of [
    { subject: OTHER },
    { authError: { message: 'synthetic credentials must not be exposed' } },
    { factoryError: new Error('synthetic JWT must not be exposed') }
  ]) {
    const { make } = fixture(options);
    await assert.rejects(
      make()({ actorId: OWNER, token: TOKEN }),
      (error) =>
        error.message === 'AI_TRIAL_AUTHOR_CLIENT_DENIED' &&
        !error.message.includes('synthetic')
    );
  }
});

test('does not reuse a bearer or Supabase client across requests', async () => {
  const { make, calls } = fixture();
  const first = await make()({ actorId: OWNER, token: TOKEN });
  const second = await make()({
    actorId: OWNER,
    token: 'another-synthetic-owner-token'
  });
  assert.notEqual(first, second);
  assert.equal(
    calls.filter((item) => item.action === 'createClient').length,
    2
  );
  assert.notEqual(
    calls[0].options.global.headers.Authorization,
    calls[2].options.global.headers.Authorization
  );
});
