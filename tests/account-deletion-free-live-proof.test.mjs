import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertFreeAccount,
  assertFreeDeletionProofContext,
  runFreeDeletionProof
} from '../scripts/account-deletion-free-live-proof.mjs';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const PREVIEW = 'https://novelrise-candidate-123.vercel.app';

function environment(overrides = {}) {
  return {
    GITHUB_REPOSITORY: 'bingohooah888-ai/novelrise',
    APPROVED_MAIN_SHA: 'a'.repeat(40),
    EXPECTED_REVISION: 'b'.repeat(40),
    OWNER_APPROVED_PREVIEW_URL: PREVIEW,
    CANONICAL_STAGING_URL: PREVIEW,
    STAGING_TRIGGER: 'approval_comment',
    STAGING_FREE_APPROVAL_SCOPE: 'account-deletion-free-proof',
    STAGING_FREE_PROOF_APPROVED: 'true',
    STAGING_DELETE_FREE_MODE: 'true',
    STAGING_E2E_READY: 'true',
    STAGING_PREVIEW_REF: 'fix/inquiry-82-account-deletion-diagnostics-20261107',
    STAGING_EXPECTED_SUPABASE_URL: 'https://wmlzjgvxgoyrovdhbqbg.supabase.co',
    STAGING_SUPABASE_SECRET_KEY: 'sb_secret_testfixture',
    STAGING_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_testfixture',
    STRIPE_TEST_SECRET_KEY: 'sk_test_' + 'x'.repeat(24),
    VERCEL_AUTOMATION_BYPASS_SECRET: 'fake-bypass-for-test',
    ...overrides
  };
}

function fakeClients({
  billing = false,
  wrongJwt = false,
  http = 200,
  residue = false
} = {}) {
  const state = {
    userExists: false,
    profileExists: false,
    email: null,
    created: 0,
    cleanup: 0,
    requests: [],
    checkedIds: [],
    adminKeys: [],
    stripeRequests: 0
  };
  function profile() {
    return state.profileExists
      ? {
          id: ID,
          avatar_path: null,
          stripe_customer_id: billing ? 'cus_unexpected' : null,
          stripe_subscription_id: null
        }
      : null;
  }
  const admin = {
    auth: {
      admin: {
        async createUser({ email }) {
          state.email = email;
          state.userExists = true;
          state.profileExists = true;
          state.created += 1;
          return { data: { user: { id: ID, email } }, error: null };
        },
        async getUserById(userId) {
          state.checkedIds.push(userId);
          return state.userExists
            ? { data: { user: { id: ID, email: state.email } }, error: null }
            : {
                data: { user: null },
                error: { status: 404, code: 'user_not_found' }
              };
        },
        async deleteUser(userId) {
          assert.equal(userId, ID);
          state.cleanup += 1;
          state.userExists = false;
          state.profileExists = false;
          return { data: { user: null }, error: null };
        }
      }
    },
    from(table) {
      return {
        select(_columns, options = {}) {
          return {
            eq(column, userId) {
              assert.equal(userId, ID);
              if (table === 'profiles') {
                assert.equal(column, 'id');
                return {
                  maybeSingle: async () => ({ data: profile(), error: null })
                };
              }
              assert.ok(options.count === 'exact' && options.head === true);
              assert.ok(
                [
                  'novels',
                  'episodes',
                  'episode_illustrations',
                  'novel_custom_covers'
                ].includes(table)
              );
              const expectedColumn = {
                novels: 'user_id',
                episodes: 'user_id',
                episode_illustrations: 'owner_user_id',
                novel_custom_covers: 'user_id'
              }[table];
              assert.equal(column, expectedColumn);
              return Promise.resolve({ count: 0, data: null, error: null });
            }
          };
        }
      };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'author-avatars');
        return {
          async list(userId) {
            assert.equal(userId, ID);
            return { data: [], error: null };
          }
        };
      }
    }
  };
  const visitor = {
    auth: {
      async signInWithPassword({ email }) {
        assert.equal(email, state.email);
        return {
          data: {
            user: { id: wrongJwt ? 'wrong-id' : ID },
            session: { access_token: 'mocked-staging-jwt' }
          },
          error: null
        };
      }
    }
  };
  const makeClient = (url, key) => {
    assert.equal(url, 'https://wmlzjgvxgoyrovdhbqbg.supabase.co');
    state.adminKeys.push(key);
    if (key.startsWith('sb_secret_')) return admin;
    if (key.startsWith('sb_publishable_')) return visitor;
    throw new Error('unrecognized test client');
  };
  const fetchImpl = async (url, options) => {
    state.requests.push({ url, options });
    assert.equal(url, PREVIEW + '/api/delete-account');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.authorization, 'Bearer mocked-staging-jwt');
    assert.equal(
      options.headers['x-vercel-protection-bypass'],
      'fake-bypass-for-test'
    );
    assert.deepEqual(JSON.parse(options.body), {
      confirmation: 'アカウントを削除'
    });
    if (http === 200 && !residue) {
      state.userExists = false;
      state.profileExists = false;
    }
    return {
      status: http,
      json: async () => ({ ok: http === 200 })
    };
  };
  return { state, makeClient, fetchImpl };
}

test('Free-only proof context rejects Production URLs, wrong scopes and missing Staging keys', () => {
  const base = environment();
  assert.deepEqual(assertFreeDeletionProofContext(base), {
    previewOrigin: PREVIEW,
    staging: 'https://wmlzjgvxgoyrovdhbqbg.supabase.co'
  });
  for (const bad of [
    { CANONICAL_STAGING_URL: 'https://novelrise.vercel.app' },
    { CANONICAL_STAGING_URL: 'https://evil.com' },
    { CANONICAL_STAGING_URL: 'http://novelrise-candidate-123.vercel.app' },
    { OWNER_APPROVED_PREVIEW_URL: 'https://different.vercel.app' },
    { STAGING_TRIGGER: 'workflow_dispatch' },
    { STAGING_FREE_PROOF_APPROVED: 'false' },
    { STAGING_FREE_APPROVAL_SCOPE: 'account-deletion-free-preview' },
    { STAGING_SUPABASE_SECRET_KEY: '' },
    { STAGING_E2E_READY: 'false' },
    { STRIPE_TEST_SECRET_KEY: 'sk_live_' + 'x'.repeat(24) },
    {
      STAGING_EXPECTED_SUPABASE_URL: 'https://fiepaguycecrredwrcwx.supabase.co'
    },
    { EXPECTED_REVISION: 'a'.repeat(40) }
  ]) {
    assert.throws(
      () => assertFreeDeletionProofContext(environment(bad)),
      /FREE_DELETION_STAGING_HOLD/,
      JSON.stringify(Object.keys(bad))
    );
  }
});

test('Free-only fixture denies any preexisting Stripe billing ID, avatar or content', () => {
  const clean = {
    novels: 0,
    episodes: 0,
    illustrations: 0,
    covers: 0,
    avatars: 0
  };
  const profile = {
    id: ID,
    avatar_path: null,
    stripe_customer_id: null,
    stripe_subscription_id: null
  };
  assert.equal(assertFreeAccount(profile, ID, clean), undefined);
  for (const update of [
    { stripe_customer_id: 'cus_wrong' },
    { stripe_subscription_id: 'sub_wrong' },
    { avatar_path: ID + '/avatar.webp' },
    { id: 'another-user' }
  ]) {
    assert.throws(() =>
      assertFreeAccount({ ...profile, ...update }, ID, clean)
    );
  }
  assert.throws(() => assertFreeAccount(profile, ID, { ...clean, novels: 1 }));
});

test('Free JWT deletion verifies own new fixture, real API contract and no residue without Stripe requests', async () => {
  const mock = fakeClients();
  const result = await runFreeDeletionProof({
    env: environment(),
    makeClient: mock.makeClient,
    fetchImpl: mock.fetchImpl
  });
  assert.deepEqual(result, { passed: true, scope: 'free-ephemeral-only' });
  assert.equal(mock.state.created, 1);
  assert.equal(mock.state.requests.length, 1);
  assert.equal(mock.state.cleanup, 0);
  assert.equal(mock.state.userExists, false);
  assert.equal(mock.state.profileExists, false);
  assert.equal(mock.state.stripeRequests, 0);
  assert.ok(mock.state.checkedIds.every((id) => id === ID));
  assert.deepEqual(mock.state.adminKeys, [
    'sb_secret_testfixture',
    'sb_publishable_testfixture'
  ]);
});

test('Invalid JWT stops before delete request and cleans only the freshly created fixture', async () => {
  const mock = fakeClients({ wrongJwt: true });
  await assert.rejects(
    runFreeDeletionProof({
      env: environment(),
      makeClient: mock.makeClient,
      fetchImpl: mock.fetchImpl
    }),
    /FREE_DELETION_STAGING_HOLD/
  );
  assert.equal(mock.state.requests.length, 0);
  assert.equal(mock.state.cleanup, 1);
  assert.equal(mock.state.userExists, false);
});

test('Unexpected Stripe customer ID refuses the delete request AND cleanup', async () => {
  const mock = fakeClients({ billing: true });
  await assert.rejects(
    runFreeDeletionProof({
      env: environment(),
      makeClient: mock.makeClient,
      fetchImpl: mock.fetchImpl
    }),
    /CLEANUP_UNVERIFIED/
  );
  assert.equal(mock.state.requests.length, 0);
  assert.equal(mock.state.cleanup, 0);
});

test('Delete API failure never counts as success and triggers scoped fixture cleanup', async () => {
  const mock = fakeClients({ http: 500 });
  await assert.rejects(
    runFreeDeletionProof({
      env: environment(),
      makeClient: mock.makeClient,
      fetchImpl: mock.fetchImpl
    }),
    /FREE_DELETION_STAGING_HOLD/
  );
  assert.equal(mock.state.requests.length, 1);
  assert.equal(mock.state.cleanup, 1);
});

test('Success HTTP without actual deletion fails residual verification, then cleans only own fixture', async () => {
  const mock = fakeClients({ residue: true });
  await assert.rejects(
    runFreeDeletionProof({
      env: environment(),
      makeClient: mock.makeClient,
      fetchImpl: mock.fetchImpl
    }),
    /FREE_DELETION_STAGING_HOLD/
  );
  assert.equal(mock.state.requests.length, 1);
  assert.equal(mock.state.cleanup, 1);
});
