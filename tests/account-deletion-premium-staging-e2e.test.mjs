import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { admitPremiumStagingOnce } from '../scripts/account-deletion-premium-staging-admission.mjs';
import {
  checkPremiumTargetContext,
  validatePremiumPreviewInventory,
  validatePremiumPreviewFacts,
  verifyPremiumPreview
} from '../scripts/account-deletion-premium-staging-target.mjs';
import {
  verifyPremiumPriceCatalog,
  runPremiumDeletionProof
} from '../scripts/account-deletion-premium-staging-live-proof.mjs';
import { REVIEWED_FILES } from '../scripts/account-deletion-preview-admission.mjs';
import { attestPremiumStagingAccount } from '../api/staging-premium-account-proof.js';

const MAIN = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const ISSUE = 5273934770;
const BRANCH = 'fix/inquiry-82-account-deletion-diagnostics-20261107';
const STAGING = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
const PREVIEW = 'https://novelrise-abc123.vercel.app';
const ACCOUNT = 'acct_' + 'Z'.repeat(16);
const DIGEST = createHash('sha256').update(ACCOUNT).digest('hex');
const KEY = 'sk_test_' + 'k'.repeat(28);
const PRICE = 'price_' + 'p'.repeat(17);
const PRODUCT = 'prod_' + 'p'.repeat(17);

function env(overrides = {}) {
  return {
    GITHUB_REPOSITORY: 'bingohooah888-ai/novelrise',
    GITHUB_RUN_ATTEMPT: '1',
    APPROVED_MAIN_SHA: MAIN,
    EXPECTED_REVISION: HEAD,
    STAGING_PREVIEW_REF: BRANCH,
    STAGING_EXPECTED_SUPABASE_URL: STAGING,
    STAGING_TRIGGER: 'approval_comment',
    STAGING_PREMIUM_APPROVED: 'true',
    STAGING_PREMIUM_SCOPE: 'account-deletion-premium-staging-e2e-once',
    STAGING_E2E_READY: 'true',
    STAGING_SUPABASE_SECRET_KEY: 'sb_secret_' + 's'.repeat(24),
    STAGING_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' + 'a'.repeat(24),
    STRIPE_TEST_SECRET_KEY: KEY,
    STRIPE_TEST_EXPECTED_ACCOUNT_SHA256: DIGEST,
    VERCEL_API_TOKEN: 'vercel_mock_token_123456',
    VERCEL_AUTOMATION_BYPASS_SECRET: 'protected_mock_bypass',
    CANONICAL_STAGING_URL: PREVIEW,
    ...overrides
  };
}

function inventory(e) {
  return [
    { key: 'SUPABASE_URL', value: STAGING, type: 'plain' },
    { key: 'NOVELIGHT_STAGING_SUPABASE_URL', value: STAGING, type: 'plain' },
    {
      key: 'SUPABASE_PUBLISHABLE_KEY',
      value: e.STAGING_SUPABASE_PUBLISHABLE_KEY,
      type: 'sensitive'
    },
    {
      key: 'NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY',
      value: e.STAGING_SUPABASE_PUBLISHABLE_KEY,
      type: 'sensitive'
    },
    {
      key: 'SUPABASE_SECRET_KEY',
      value: e.STAGING_SUPABASE_SECRET_KEY,
      type: 'sensitive'
    },
    {
      key: 'STRIPE_SECRET_KEY',
      value: e.STRIPE_TEST_SECRET_KEY,
      type: 'sensitive'
    }
  ].map((row) => ({ ...row, target: ['preview'], gitBranch: BRANCH }));
}

function facts(e) {
  return {
    commitSha: HEAD,
    vercelEnv: 'preview',
    appBaseUrl: PREVIEW,
    supabase: {
      url: STAGING,
      publishableKeyClass: 'publishable',
      publishableKeyFingerprint: createHash('sha256')
        .update(e.STAGING_SUPABASE_PUBLISHABLE_KEY)
        .digest('hex'),
      serverSecretPresent: true
    },
    stripe: {
      secretKeyMode: 'test',
      standardPricePresent: false,
      premiumPricePresent: false
    }
  };
}

function admission() {
  const body =
    'NOVELIGHT_STAGING_ACCOUNT_DELETE_PREMIUM_E2E_APPROVE ' +
    JSON.stringify({
      scope: 'account-deletion-premium-staging-e2e-once',
      mainSha: MAIN,
      candidateSha: HEAD,
      confirmation: 'PREMIUM STAGING JWT E2E APPROVED'
    });
  const issue = {
    id: ISSUE,
    number: 188,
    url: 'https://api.github.com/repos/bingohooah888-ai/novelrise/issues/188',
    title: '[Staging Approval Control] Preview / Staging cost gate',
    state: 'open',
    locked: false,
    user: { login: 'bingohooah888-ai' }
  };
  const event = {
    repository: { full_name: 'bingohooah888-ai/novelrise' },
    issue: { ...issue },
    comment: {
      id: 999,
      body,
      user: { login: 'bingohooah888-ai', id: 317436651 },
      author_association: 'OWNER'
    }
  };
  return {
    issue,
    event,
    mainRef: { object: { sha: MAIN } },
    checkedOutSha: MAIN,
    pr: {
      number: 2785,
      state: 'open',
      draft: true,
      merged: false,
      user: { login: 'bingohooah888-ai' },
      base: { ref: 'main', sha: MAIN },
      head: {
        ref: BRANCH,
        sha: HEAD,
        repo: { full_name: 'bingohooah888-ai/novelrise' }
      }
    },
    compare: {
      status: 'ahead',
      behind_by: 0,
      ahead_by: 1,
      total_commits: 1,
      base_commit: { sha: MAIN },
      commits: [{ sha: HEAD }],
      files: REVIEWED_FILES.map((f) => ({
        filename: f.path,
        status: f.status,
        sha: f.sha
      }))
    },
    ledgerPages: [[{ id: 999, body, user: { login: 'bingohooah888-ai' } }]]
  };
}

function correctPrice(overrides = {}) {
  return {
    id: PRICE,
    object: 'price',
    livemode: false,
    active: true,
    lookup_key: 'novelight_premium_beta_2026_monthly_jpy',
    currency: 'jpy',
    unit_amount: 480,
    type: 'recurring',
    billing_scheme: 'per_unit',
    recurring: {
      interval: 'month',
      interval_count: 1,
      usage_type: 'licensed'
    },
    metadata: {
      novelight_managed: 'true',
      novelight_plan: 'premium',
      novelight_beta_price: '480'
    },
    product: {
      id: PRODUCT,
      object: 'product',
      name: 'NOVELIGHT Premium Beta',
      active: true,
      livemode: false,
      metadata: {
        novelight_managed: 'true',
        novelight_plan: 'premium',
        novelight_beta_price: '480'
      }
    },
    ...overrides
  };
}

test('new exact OWNER one-use grant and all reviewed 7 blobs admitted', () => {
  assert.deepEqual(admitPremiumStagingOnce(admission()), {
    mainSha: MAIN,
    candidateSha: HEAD,
    approvalCommentId: '999',
    candidateRef: BRANCH
  });
});

test('owner, main, PR, blob and reused claim must all match (default deny)', () => {
  const edits = [
    (x) => {
      x.event.comment.user.id = 1;
    },
    (x) => {
      x.event.comment.author_association = 'CONTRIBUTOR';
    },
    (x) => {
      x.issue.state = 'closed';
    },
    (x) => {
      x.mainRef.object.sha = 'f'.repeat(40);
    },
    (x) => {
      x.pr.head.sha = 'f'.repeat(40);
    },
    (x) => {
      x.pr.draft = false;
    },
    (x) => {
      x.compare.files[0].sha = 'f'.repeat(40);
    },
    (x) => {
      x.compare.files.push({ filename: 'oops' });
    },
    (x) => {
      x.compare.behind_by = 1;
    },
    (x) => {
      x.ledgerPages[0][0].body += ' ';
    },
    (x) => {
      x.ledgerPages.push(Array.from({ length: 100 }, () => ({ body: 'x' })));
    },
    (x) => {
      x.ledgerPages[0].push({
        body:
          'NOVELIGHT_STAGING_ACCOUNT_DELETE_PREMIUM_E2E_CLAIMED ' +
          JSON.stringify({
            requestCommentId: '999',
            mainSha: MAIN,
            candidateSha: HEAD,
            runId: '777'
          })
      });
    },
    (x) => {
      x.ledgerPages[0].push({
        body:
          'NOVELIGHT_STAGING_ACCOUNT_DELETE_PREMIUM_E2E_CONSUMED ' +
          JSON.stringify({
            requestCommentId: '999',
            mainSha: MAIN,
            candidateSha: HEAD,
            runId: '777',
            result: 'success'
          })
      });
    }
  ];
  for (const edit of edits) {
    const a = admission();
    edit(a);
    assert.throws(
      () => admitPremiumStagingOnce(a),
      /PREMIUM_STAGING_ADMISSION_DENIED/u
    );
  }
});

test('six Preview secrets must be branch-specific and equal to reviewed Staging credentials', () => {
  const e = env();
  assert.equal(checkPremiumTargetContext(e), true);
  assert.deepEqual(validatePremiumPreviewInventory(inventory(e), e), {
    branch: BRANCH,
    keyCount: 6,
    isolated: true
  });
  for (const bad of [
    { STRIPE_TEST_SECRET_KEY: 'sk_live_' + 'x'.repeat(24) },
    {
      STAGING_EXPECTED_SUPABASE_URL: 'https://fiepaguycecrredwrcwx.supabase.co'
    },
    { GITHUB_RUN_ATTEMPT: '2' },
    { STAGING_PREMIUM_SCOPE: 'account-deletion-free-proof' }
  ])
    assert.throws(() => checkPremiumTargetContext(env(bad)));
  const unreadable = inventory(e);
  unreadable[5].value = undefined;
  assert.equal(validatePremiumPreviewInventory(unreadable, e).isolated, true);
  // Actual key equality is checked through Preview account attestation,
  // never by trying to retrieve saved Vercel Secrets.
  const wrongBranch = inventory(e);
  wrongBranch[3].gitBranch = 'main';
  assert.throws(() => validatePremiumPreviewInventory(wrongBranch, e));
  assert.throws(() =>
    validatePremiumPreviewInventory(inventory(e).slice(1), e)
  );
});

test('only matching SHA and isolated runtime with Stripe TEST and Staging Supabase accepted', () => {
  const e = env();
  assert.equal(validatePremiumPreviewFacts(facts(e), e).verified, true);
  // Existing Preview env price IDs can be present. Neither is used by this
  // test; only the verified Premium TEST lookup key can select a price.
  for (const [standard, premium] of [
    [true, true],
    [true, false],
    [false, true]
  ]) {
    const observed = facts(e);
    observed.stripe.standardPricePresent = standard;
    observed.stripe.premiumPricePresent = premium;
    assert.equal(validatePremiumPreviewFacts(observed, e).verified, true);
  }
  const changes = [
    (x) => {
      x.vercelEnv = 'production';
    },
    (x) => {
      x.commitSha = 'c'.repeat(40);
    },
    (x) => {
      x.supabase.url = 'https://fiepaguycecrredwrcwx.supabase.co';
    },
    (x) => {
      x.supabase.publishableKeyFingerprint = '0'.repeat(64);
    },
    (x) => {
      x.supabase.serverSecretPresent = false;
    },
    (x) => {
      x.stripe.secretKeyMode = 'live';
    },
    (x) => {
      x.stripe.standardPricePresent = 'yes';
    },
    (x) => {
      x.stripe.premiumPricePresent = null;
    }
  ];
  for (const change of changes) {
    const v = facts(e);
    change(v);
    assert.throws(() => validatePremiumPreviewFacts(v, e));
  }
  assert.throws(() =>
    validatePremiumPreviewFacts(
      facts(
        env({
          CANONICAL_STAGING_URL: 'https://novelrise.vercel.app'
        })
      ),
      env({ CANONICAL_STAGING_URL: 'https://novelrise.vercel.app' })
    )
  );
});

test('premium beta 480 monthly exactly one TEST lookup; no Standard price', () => {
  assert.equal(
    verifyPremiumPriceCatalog({
      object: 'list',
      has_more: false,
      data: [correctPrice()]
    }),
    PRICE
  );
  for (const mutation of [
    (p) => {
      p.livemode = true;
    },
    (p) => {
      p.unit_amount = 490;
    },
    (p) => {
      p.lookup_key = 'novelight_standard_monthly_jpy';
    },
    (p) => {
      p.recurring.interval = 'year';
    },
    (p) => {
      p.product.active = false;
    }
  ]) {
    const item = correctPrice();
    mutation(item);
    assert.throws(() =>
      verifyPremiumPriceCatalog({
        object: 'list',
        has_more: false,
        data: [item]
      })
    );
  }
  assert.throws(() =>
    verifyPremiumPriceCatalog({
      object: 'list',
      has_more: true,
      data: [correctPrice()]
    })
  );
});

test('workflow never executes on push/PR/dispatch, requires OWNER and Staging and no secrets edits', () => {
  const yml = readFileSync(
    new globalThis.URL(
      '../.github/workflows/account-deletion-premium-staging-e2e-once.yml',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(yml, /issue_comment:/u);
  assert.doesNotMatch(
    yml,
    /^\s+(?:push|pull_request|workflow_dispatch|schedule):/mu
  );
  assert.match(yml, /environment: staging/u);
  assert.match(yml, /github\.run_attempt == 1/u);
  assert.match(yml, /PREMIUM_E2E_APPROVE/u);
  assert.match(
    yml,
    /account-deletion-premium-staging-target\.mjs --preflight/u
  );
  assert.match(
    yml,
    /account-deletion-premium-staging-live-proof\.mjs --approved-once/u
  );
  assert.doesNotMatch(yml, /sk_live_|PRODUCTION_DEPLOY/u);
});

function mockPaidProof({
  deletionHttp = 200,
  wrongJwt = false,
  profileLinkFailure = null
} = {}) {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const state = {
    id,
    email: null,
    removed: false,
    profile: null,
    novel: null,
    avatar: null,
    uploadedAvatarPath: null,
    customer: null,
    subscription: null,
    previewDeleteCalls: 0,
    stripeCancelCalls: 0,
    customerDeleteCalls: 0,
    cleanupAuthCalls: 0,
    createCustomerCalls: 0,
    createSubscriptionCalls: 0,
    apiDeleteCalls: 0
  };
  function table(name) {
    let kind = 'select';
    let payload = null;
    const q = {
      select() {
        return q;
      },
      eq() {
        return q;
      },
      is() {
        return q;
      },
      insert(row) {
        kind = 'insert';
        payload = row;
        return q;
      },
      update(row) {
        kind = 'update';
        payload = row;
        return q;
      },
      delete() {
        kind = 'delete';
        return q;
      },
      async single() {
        if (name === 'novels' && kind === 'insert') {
          state.novel = { id: 42, user_id: state.id, ...payload };
          return { data: { ...state.novel }, error: null };
        }
        return { data: null, error: { message: 'unknown operation' } };
      },
      async maybeSingle() {
        if (name === 'profiles' && kind === 'update') {
          // Mirror the actual Staging profiles_avatar_path_check constraint.
          // The former novelight-premium-e2e-<nonce>.png path fails this check.
          const allowed = new RegExp(
            '^' + state.id + '/[0-9a-f-]{36}\\.(webp|png|jpg|jpeg)$',
            'u'
          );
          if (
            !allowed.test(payload?.avatar_path) ||
            profileLinkFailure === 'db'
          )
            return { data: null, error: { code: '23514' } };
          if (profileLinkFailure === 'no-row' || !state.profile)
            return { data: null, error: null };
          state.profile = { ...state.profile, ...payload };
          return {
            data:
              profileLinkFailure === 'mismatch'
                ? { ...state.profile, stripe_subscription_id: 'sub_mismatched' }
                : { ...state.profile },
            error: null
          };
        }
        return {
          data:
            name === 'profiles'
              ? state.profile
              : name === 'novels'
                ? state.novel
                : null,
          error: null
        };
      },
      then(onFulfilled, onRejected) {
        if (kind === 'delete') {
          if (name === 'novels') state.novel = null;
          return Promise.resolve({ data: [], error: null }).then(
            onFulfilled,
            onRejected
          );
        }
        return Promise.resolve({
          data: null,
          error: null,
          count: name === 'novels' ? Number(Boolean(state.novel)) : 0
        }).then(onFulfilled, onRejected);
      }
    };
    return q;
  }
  const admin = {
    auth: {
      admin: {
        async createUser({ email }) {
          state.email = email;
          state.profile = {
            id: state.id,
            avatar_path: null,
            plan: 'free',
            stripe_customer_id: null,
            stripe_subscription_id: null
          };
          return { data: { user: { id: state.id, email } }, error: null };
        },
        async getUserById(uid) {
          assert.equal(uid, id);
          return state.removed
            ? { data: { user: null }, error: { status: 404 } }
            : { data: { user: { id, email: state.email } }, error: null };
        },
        async deleteUser(uid) {
          assert.equal(uid, id);
          state.cleanupAuthCalls += 1;
          state.removed = true;
          state.profile = null;
          return { data: {}, error: null };
        }
      }
    },
    from: table,
    storage: {
      from(bucket) {
        assert.equal(bucket, 'author-avatars');
        return {
          async list(uid) {
            assert.equal(uid, id);
            return {
              data: state.avatar ? [{ name: state.avatar.split('/')[1] }] : [],
              error: null
            };
          },
          async upload(p) {
            state.avatar = p;
            state.uploadedAvatarPath = p;
            return { data: { path: p }, error: null };
          },
          async remove(paths) {
            assert.deepEqual(paths, [state.avatar]);
            state.avatar = null;
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
            user: { id: wrongJwt ? 'wrong' : id },
            session: { access_token: 'real-staging-jwt-test-double' }
          },
          error: null
        };
      }
    }
  };
  const makeClient = (url, key) => {
    assert.equal(url, STAGING);
    if (key === env().STAGING_SUPABASE_SECRET_KEY) return admin;
    if (key === env().STAGING_SUPABASE_PUBLISHABLE_KEY) return visitor;
    throw new Error('unknown client');
  };
  const stripe = {
    accounts: {
      async retrieve() {
        return { id: ACCOUNT };
      }
    },
    prices: {
      async list(request) {
        assert.deepEqual(request.lookup_keys, [
          'novelight_premium_beta_2026_monthly_jpy'
        ]);
        assert.equal(request.active, true);
        return { object: 'list', has_more: false, data: [correctPrice()] };
      }
    },
    customers: {
      async create({ email, metadata }) {
        state.createCustomerCalls += 1;
        state.customer = {
          id: 'cus_12345678912345',
          object: 'customer',
          livemode: false,
          email,
          metadata
        };
        return { ...state.customer };
      },
      async retrieve() {
        return state.customer?.deleted
          ? { id: state.customer.id, deleted: true }
          : { ...state.customer };
      },
      async list() {
        return {
          has_more: false,
          data:
            state.customer && !state.customer.deleted ? [state.customer] : []
        };
      },
      async del() {
        state.customerDeleteCalls += 1;
        state.customer.deleted = true;
        return { deleted: true };
      }
    },
    subscriptions: {
      async create({ customer, items, trial_period_days, metadata }) {
        assert.equal(customer, state.customer.id);
        assert.equal(items[0].price, PRICE);
        assert.equal(trial_period_days, 2);
        state.createSubscriptionCalls += 1;
        state.subscription = {
          id: 'sub_12345678912345',
          object: 'subscription',
          livemode: false,
          customer,
          status: 'trialing',
          metadata,
          default_payment_method: null,
          items: { data: [{ price: { id: PRICE } }] }
        };
        return { ...state.subscription };
      },
      async retrieve() {
        return { ...state.subscription };
      },
      async list() {
        return {
          has_more: false,
          data: state.subscription ? [{ ...state.subscription }] : []
        };
      },
      async cancel() {
        state.stripeCancelCalls += 1;
        state.subscription.status = 'canceled';
        return { ...state.subscription };
      }
    }
  };
  const fetchImpl = async (url, options) => {
    assert.equal(url, PREVIEW + '/api/delete-account');
    assert.equal(options.method, 'POST');
    assert.equal(
      options.headers.authorization,
      'Bearer real-staging-jwt-test-double'
    );
    assert.equal(JSON.parse(options.body).confirmation, 'アカウントを削除');
    state.previewDeleteCalls += 1;
    if (deletionHttp === 200) {
      state.apiDeleteCalls += 1;
      state.subscription.status = 'canceled';
      state.avatar = null;
      state.novel = null;
      state.removed = true;
      state.profile = null;
    }
    return {
      status: deletionHttp,
      json: async () => ({ ok: deletionHttp === 200 })
    };
  };
  return {
    state,
    run: () =>
      runPremiumDeletionProof({
        env: env(),
        makeClient,
        createStripe: () => stripe,
        fetchImpl,
        verifyPreview: async () => ({ verified: true })
      })
  };
}

test('Premium E2E synthetic TEST trial: only own user, one real JWT delete, canceled sub, no residue', async () => {
  const mock = mockPaidProof();
  const outcome = await mock.run();
  assert.deepEqual(outcome, {
    passed: true,
    scope: 'premium-staging-test-only',
    billing: 'canceled',
    residue: 'absent'
  });
  assert.equal(mock.state.createCustomerCalls, 1);
  assert.equal(mock.state.createSubscriptionCalls, 1);
  // Regress the real Staging constraint: <owner UUID>/<file UUID>.png.
  assert.match(
    mock.state.uploadedAvatarPath,
    /^123e4567-e89b-42d3-a456-426614174000\/[0-9a-f-]{36}\.png$/u
  );
  assert.equal(mock.state.previewDeleteCalls, 1);
  assert.equal(mock.state.apiDeleteCalls, 1);
  assert.equal(mock.state.subscription.status, 'canceled');
  assert.equal(mock.state.customer.deleted, true);
  assert.equal(mock.state.novel, null);
  assert.equal(mock.state.avatar, null);
  assert.equal(mock.state.profile, null);
  assert.equal(mock.state.removed, true);
  assert.equal(mock.state.cleanupAuthCalls, 0);
});

test('Premium E2E invalid JWT denies before any Stripe/customer writes and cleans own auth', async () => {
  const mock = mockPaidProof({ wrongJwt: true });
  await assert.rejects(mock.run(), /PREMIUM_DELETION_STAGING_HOLD_AUTH_JWT/u);
  assert.equal(mock.state.createCustomerCalls, 0);
  assert.equal(mock.state.previewDeleteCalls, 0);
  assert.equal(mock.state.cleanupAuthCalls, 1);
  assert.equal(mock.state.removed, true);
});

test('Premium E2E API 500 does not count as success; cancels only fixture trial and cleans own content', async () => {
  const mock = mockPaidProof({ deletionHttp: 500 });
  await assert.rejects(
    mock.run(),
    /PREMIUM_DELETION_STAGING_HOLD_PREVIEW_DELETE/u
  );
  assert.equal(mock.state.previewDeleteCalls, 1);
  assert.equal(mock.state.stripeCancelCalls, 1);
  assert.equal(mock.state.subscription.status, 'canceled');
  assert.equal(mock.state.customerDeleteCalls, 1);
  assert.equal(mock.state.customer.deleted, true);
  assert.equal(mock.state.avatar, null);
  assert.equal(mock.state.novel, null);
  assert.equal(mock.state.removed, true);
});

test('Preview account proof compares only TEST account fingerprint; never returns ID', async () => {
  const good = await attestPremiumStagingAccount({
    env: {
      VERCEL_ENV: 'preview',
      SUPABASE_URL: STAGING,
      STRIPE_SECRET_KEY: KEY
    },
    expectedSha256: DIGEST,
    retrieveAccount: async () => ({ id: ACCOUNT })
  });
  assert.deepEqual(good, { accountMatch: true });
  assert.doesNotMatch(JSON.stringify(good), /acct_|sk_test_/u);
  for (const changes of [
    { VERCEL_ENV: 'production' },
    { SUPABASE_URL: 'https://fiepaguycecrredwrcwx.supabase.co' },
    { STRIPE_SECRET_KEY: 'sk_live_' + 'x'.repeat(26) }
  ]) {
    await assert.rejects(
      attestPremiumStagingAccount({
        env: {
          VERCEL_ENV: 'preview',
          SUPABASE_URL: STAGING,
          STRIPE_SECRET_KEY: KEY,
          ...changes
        },
        expectedSha256: DIGEST,
        retrieveAccount: async () => ({ id: ACCOUNT })
      }),
      /STAGING_PROOF_DENIED/u
    );
  }
  await assert.rejects(
    attestPremiumStagingAccount({
      env: {
        VERCEL_ENV: 'preview',
        SUPABASE_URL: STAGING,
        STRIPE_SECRET_KEY: KEY
      },
      expectedSha256: DIGEST,
      retrieveAccount: async () => ({ id: 'acct_WRONG_ACCOUNT' })
    }),
    /STAGING_PROOF_DENIED/u
  );
});

test('Preview verified only after environment facts AND exact TEST account proof', async () => {
  const e = env();
  const requests = [];
  const fetchImpl = async (url, options) => {
    const parsed = new globalThis.URL(url);
    requests.push({ path: parsed.pathname, headers: options.headers });
    assert.equal(parsed.origin, PREVIEW);
    assert.equal(options.method, 'GET');
    assert.equal(
      options.headers['x-vercel-protection-bypass'],
      e.VERCEL_AUTOMATION_BYPASS_SECRET
    );
    return {
      ok: true,
      json: async () => {
        if (parsed.pathname === '/api/staging-environment-facts') {
          const observed = facts(e);
          observed.stripe.standardPricePresent = true;
          observed.stripe.premiumPricePresent = true;
          return observed;
        }
        if (parsed.pathname === '/api/staging-premium-account-proof') {
          assert.equal(
            options.headers['x-novelight-expected-account-sha256'],
            DIGEST
          );
          return { accountMatch: true };
        }
        throw new Error('unexpected API');
      }
    };
  };
  const result = await verifyPremiumPreview({ env: e, fetchImpl });
  assert.equal(result.verified, true);
  assert.deepEqual(
    requests.map((r) => r.path),
    ['/api/staging-environment-facts', '/api/staging-premium-account-proof']
  );
  await assert.rejects(
    verifyPremiumPreview({
      env: e,
      fetchImpl: async (_url, options) => ({
        ok: true,
        json: async () =>
          options.headers['x-novelight-expected-account-sha256']
            ? { accountMatch: false }
            : facts(e)
      })
    }),
    /PREMIUM_STAGING_TARGET_DENIED/u
  );
});

test('existing Preview price ID flags are informational, never a price selection source', () => {
  const e = env({
    STRIPE_STANDARD_PRICE_ID: 'price_untrusted_standard',
    STRIPE_PREMIUM_PRICE_ID: 'price_untrusted_premium'
  });
  const liveFacts = facts(e);
  liveFacts.stripe.standardPricePresent = true;
  liveFacts.stripe.premiumPricePresent = true;
  assert.equal(validatePremiumPreviewFacts(liveFacts, e).verified, true);
  // No deletion or fixture code may consume the legacy price ID values.
  for (const relative of [
    '../scripts/account-deletion-premium-staging-live-proof.mjs',
    '../api/delete-account.js',
    '../api/_lib/delete-account.js'
  ]) {
    const source = readFileSync(
      new globalThis.URL(relative, import.meta.url),
      'utf8'
    );
    assert.doesNotMatch(source, /\bSTRIPE_(?:STANDARD|PREMIUM)_PRICE_ID\b/u);
  }
  const fixtureCode = readFileSync(
    new globalThis.URL(
      '../scripts/account-deletion-premium-staging-live-proof.mjs',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(fixtureCode, /lookup_keys:\s*\[LOOKUP\]/u);
  assert.match(fixtureCode, /price\.unit_amount !== PRICE_JPY/u);
  assert.match(fixtureCode, /price\.livemode !== false/u);
});

test('protected Preview HTTP rejection is safely classified before touching Stripe proof', async () => {
  const requests = [];
  await assert.rejects(
    verifyPremiumPreview({
      env: env(),
      fetchImpl: async (url) => {
        requests.push(new globalThis.URL(url).pathname);
        return {
          ok: false,
          status: 403,
          json: async () => ({ secret: 'must_not_be_logged' })
        };
      }
    }),
    /PREMIUM_STAGING_TARGET_DENIED_FACTS_HTTP/u
  );
  assert.deepEqual(requests, ['/api/staging-environment-facts']);
});

test('account fingerprint endpoint HTTP rejection produces distinct safe diagnostic', async () => {
  const requests = [];
  const e = env();
  await assert.rejects(
    verifyPremiumPreview({
      env: e,
      fetchImpl: async (url) => {
        const path = new globalThis.URL(url).pathname;
        requests.push(path);
        if (path === '/api/staging-environment-facts') {
          const observed = facts(e);
          observed.stripe.standardPricePresent = true;
          observed.stripe.premiumPricePresent = true;
          return { ok: true, json: async () => observed };
        }
        return {
          ok: false,
          status: 401,
          json: async () => ({ secret: 'must_not_be_logged' })
        };
      }
    }),
    /PREMIUM_STAGING_TARGET_DENIED_ACCOUNT_PROOF_HTTP/u
  );
  assert.deepEqual(requests, [
    '/api/staging-environment-facts',
    '/api/staging-premium-account-proof'
  ]);
});

test('Staging avatar constraint rejects the former marker filename and accepts UUID filenames', () => {
  const ownerId = '123e4567-e89b-42d3-a456-426614174000';
  const pattern = new RegExp(
    '^' + ownerId + '/[0-9a-f-]{36}\\.(webp|png|jpg|jpeg)$',
    'u'
  );
  const former = ownerId + '/novelight-premium-e2e-abcdef0123456789.png';
  const valid = ownerId + '/7f3f5f8c-8a4b-4e91-ac57-42bf34d84211.png';
  assert.equal(pattern.test(former), false);
  assert.equal(pattern.test(valid), true);
});

test('PROFILE_LINK database/constraint failure: no delete API; fixture-only billing and content cleanup', async () => {
  const mock = mockPaidProof({ profileLinkFailure: 'db' });
  await assert.rejects(
    mock.run(),
    /PREMIUM_DELETION_STAGING_HOLD_PROFILE_LINK_DB_ERROR/u
  );
  assert.equal(mock.state.previewDeleteCalls, 0);
  assert.equal(mock.state.createCustomerCalls, 1);
  assert.equal(mock.state.createSubscriptionCalls, 1);
  assert.equal(mock.state.stripeCancelCalls, 1);
  assert.equal(mock.state.customer.deleted, true);
  assert.equal(mock.state.avatar, null);
  assert.equal(mock.state.novel, null);
  assert.equal(mock.state.removed, true);
});

test('PROFILE_LINK zero updated rows: distinct safe failure code and fixture-only cleanup', async () => {
  const mock = mockPaidProof({ profileLinkFailure: 'no-row' });
  await assert.rejects(
    mock.run(),
    /PREMIUM_DELETION_STAGING_HOLD_PROFILE_LINK_NO_ROW/u
  );
  assert.equal(mock.state.previewDeleteCalls, 0);
  assert.equal(mock.state.stripeCancelCalls, 1);
  assert.equal(mock.state.customer.deleted, true);
  assert.equal(mock.state.removed, true);
});

test('PROFILE_LINK returned billing ID mismatch: no delete API and fixture-only cleanup', async () => {
  const mock = mockPaidProof({ profileLinkFailure: 'mismatch' });
  await assert.rejects(
    mock.run(),
    /PREMIUM_DELETION_STAGING_HOLD_PROFILE_LINK_MISMATCH/u
  );
  assert.equal(mock.state.previewDeleteCalls, 0);
  assert.equal(mock.state.stripeCancelCalls, 1);
  assert.equal(mock.state.customer.deleted, true);
  assert.equal(mock.state.removed, true);
});
