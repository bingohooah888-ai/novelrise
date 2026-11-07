import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { REVIEWED_FILES } from '../scripts/account-deletion-preview-admission.mjs';
import { admitAccountEnvProvision } from '../scripts/account-deletion-staging-env-admission.mjs';
import {
  assertProvisioningInventory,
  provisionAccountDeletionEnv,
  retrieveStripeTestPrices,
  validatePricePair,
  verifyStagingAdminKey
} from '../scripts/account-deletion-staging-env-provision.mjs';

const OWNER = 'bingohooah888-ai';
const REPO = OWNER + '/novelrise';
const MAIN = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const REF = 'fix/inquiry-82-account-deletion-diagnostics-20261107';
const URL = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
const PREFIX = 'NOVELIGHT_STAGING_ACCOUNT_DELETE_ENV_APPROVE ';
const DENY = /ACCOUNT_ENV_ADMISSION_DENIED/u;
const FAIL = /ACCOUNT_ENV_PROVISION_/u;

const initial = [
  { key: 'SUPABASE_URL', type: 'plain', value: URL },
  { key: 'NOVELIGHT_STAGING_SUPABASE_URL', type: 'plain', value: URL },
  { key: 'SUPABASE_PUBLISHABLE_KEY', type: 'sensitive' },
  { key: 'NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY', type: 'sensitive' }
].map((entry) => ({ ...entry, gitBranch: REF, target: ['preview'] }));

const final = [
  ...initial,
  ...[
    'SUPABASE_SECRET_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_STANDARD_PRICE_ID',
    'STRIPE_PREMIUM_PRICE_ID'
  ].map((key) => ({
    key,
    type: 'sensitive',
    gitBranch: REF,
    target: ['preview']
  }))
];

function admissionFixture() {
  const issue = {
    id: 42,
    number: 188,
    title: '[Staging Approval Control] Preview / Staging cost gate',
    state: 'open',
    locked: false,
    url: 'https://api.github.com/repos/' + REPO + '/issues/188',
    user: { login: OWNER }
  };
  const approval =
    PREFIX +
    JSON.stringify({
      scope: 'account-deletion-env-provision',
      mainSha: MAIN,
      candidateSha: HEAD,
      confirmation: 'STAGING APPROVED'
    });
  return {
    event: {
      repository: { full_name: REPO },
      issue: { ...issue },
      comment: {
        id: 1234,
        body: approval,
        user: { login: OWNER },
        author_association: 'OWNER'
      }
    },
    issue,
    mainRef: { object: { sha: MAIN } },
    checkedOutSha: MAIN,
    pr: {
      number: 2785,
      state: 'open',
      draft: true,
      merged: false,
      user: { login: OWNER },
      base: { ref: 'main', sha: MAIN },
      head: { sha: HEAD, ref: REF, repo: { full_name: REPO } }
    },
    compare: {
      status: 'ahead',
      behind_by: 0,
      ahead_by: 2,
      total_commits: 2,
      base_commit: { sha: MAIN },
      commits: [{ sha: 'c'.repeat(40) }, { sha: HEAD }],
      files: REVIEWED_FILES.map((v) => ({
        filename: v.path,
        sha: v.sha,
        status: v.status
      }))
    },
    ledgerPages: [[{ body: 'an unrelated comment' }]]
  };
}

function testPrice({ plan, lookup, amount, n }) {
  return {
    id: 'price_' + String(n).repeat(20),
    object: 'price',
    lookup_key: lookup,
    active: true,
    livemode: false,
    currency: 'jpy',
    type: 'recurring',
    unit_amount: amount,
    recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
    metadata: { novelight_plan: plan, novelight_managed: 'true' },
    product: {
      id: 'prod_' + String(n).repeat(15),
      object: 'product',
      active: true,
      livemode: false,
      metadata: { novelight_plan: plan, novelight_managed: 'true' }
    }
  };
}

function pricesFixture() {
  return [
    testPrice({
      plan: 'standard',
      lookup: 'novelight_standard_monthly_jpy',
      amount: 980,
      n: 1
    }),
    testPrice({
      plan: 'premium',
      lookup: 'novelight_premium_beta_2026_monthly_jpy',
      amount: 480,
      n: 2
    })
  ];
}

function credentialsFixture() {
  return {
    GITHUB_REPOSITORY: REPO,
    STAGING_PREVIEW_REF: REF,
    STAGING_SUPABASE_URL: URL,
    APPROVED_MAIN_SHA: MAIN,
    CHECKED_OUT_MAIN_SHA: MAIN,
    EXPECTED_FIX_SHA: HEAD,
    VERCEL_API_TOKEN: 'fake-vercel-token-123456789',
    STAGING_SUPABASE_SECRET_KEY: 'sb_secret_' + 'x'.repeat(25),
    STRIPE_TEST_SECRET_KEY: 'sk_test_' + 'y'.repeat(25)
  };
}

test('valid exact reviewed PR and unused OWNER issue grant one env provisioning', () => {
  const result = admitAccountEnvProvision(admissionFixture());
  assert.deepEqual(result, {
    mainSha: MAIN,
    candidateSha: HEAD,
    candidateRef: REF,
    approvalCommentId: '1234'
  });
});

test('closed, locked, unsigned, forked, drifted, unreviewed or duplicate approvals deny', () => {
  const mutations = [
    (f) => {
      f.issue.state = 'closed';
    },
    (f) => {
      f.issue.locked = true;
    },
    (f) => {
      f.event.comment.author_association = 'CONTRIBUTOR';
    },
    (f) => {
      f.event.comment.user.login = 'not-owner';
    },
    (f) => {
      f.event.issue.number = 187;
    },
    (f) => {
      f.mainRef.object.sha = 'c'.repeat(40);
    },
    (f) => {
      f.checkedOutSha = 'c'.repeat(40);
    },
    (f) => {
      f.pr.base.sha = 'c'.repeat(40);
    },
    (f) => {
      f.pr.head.sha = 'c'.repeat(40);
    },
    (f) => {
      f.pr.head.repo.full_name = 'other/repo';
    },
    (f) => {
      f.pr.draft = false;
    },
    (f) => {
      f.compare.behind_by = 1;
    },
    (f) => {
      f.compare.files[0].sha = 'c'.repeat(40);
    },
    (f) => {
      f.compare.files.push({ filename: 'evil.js' });
    },
    (f) => {
      f.ledgerPages = [];
    },
    (f) => {
      f.ledgerPages = [Array.from({ length: 100 }, () => ({ body: 'other' }))];
    },
    (f) => {
      f.ledgerPages = [
        [
          {
            body:
              'NOVELIGHT_STAGING_ACCOUNT_DELETE_ENV_CLAIMED ' +
              JSON.stringify({
                requestCommentId: '1234',
                mainSha: MAIN,
                candidateSha: HEAD,
                runId: '9900'
              })
          }
        ]
      ];
    },
    (f) => {
      f.ledgerPages = [
        [
          {
            body:
              'NOVELIGHT_STAGING_ACCOUNT_DELETE_ENV_CONSUMED ' +
              JSON.stringify({
                requestCommentId: '1234',
                mainSha: MAIN,
                candidateSha: HEAD,
                runId: '9900',
                result: 'failure'
              })
          }
        ]
      ];
    },
    (f) => {
      f.event.comment.body =
        'NOVELIGHT_STAGING_ACCOUNT_DELETE_PREVIEW_APPROVE {}';
    },
    (f) => {
      f.event.comment.body = PREFIX + '{}';
    },
    (f) => {
      f.event.comment.body =
        PREFIX +
        JSON.stringify({
          scope: 'account-deletion-preview',
          mainSha: MAIN,
          candidateSha: HEAD,
          confirmation: 'STAGING APPROVED'
        });
    }
  ];
  for (const [index, mutation] of mutations.entries()) {
    const f = admissionFixture();
    mutation(f);
    assert.throws(
      () => admitAccountEnvProvision(f),
      DENY,
      'negative case ' + index
    );
  }
});

test('inventory is exactly four before, eight after, and branch-only preview', () => {
  assert.equal(
    assertProvisioningInventory(initial, 'before').configuredKeys,
    4
  );
  assert.equal(assertProvisioningInventory(final, 'after').configuredKeys, 8);
  const wrong = [
    [initial.slice(1), 'before'],
    [[...initial, ...final.slice(4)], 'before'],
    [[...initial, ...initial.slice(0, 1)], 'before'],
    [
      initial.map((v, i) => (i === 0 ? { ...v, gitBranch: null } : v)),
      'before'
    ],
    [
      initial.map((v, i) => (i === 0 ? { ...v, target: ['production'] } : v)),
      'before'
    ],
    [
      initial.map((v, i) =>
        i === 0
          ? { ...v, value: 'https://fiepaguycecrredwrcwx.supabase.co' }
          : v
      ),
      'before'
    ],
    [final.slice(0, 7), 'after'],
    [final.map((v, i) => (i === 7 ? { ...v, type: 'plain' } : v)), 'after']
  ];
  for (const [envs, stage] of wrong) {
    assert.throws(() => assertProvisioningInventory(envs, stage), FAIL);
  }
});

test('Stripe requires two distinct active test prices, expected amounts and metadata', () => {
  assert.deepEqual(validatePricePair(pricesFixture()), {
    standardPriceId: 'price_' + '1'.repeat(20),
    premiumPriceId: 'price_' + '2'.repeat(20)
  });
  const mutations = [
    (v) => {
      v[0].livemode = true;
    },
    (v) => {
      v[1].active = false;
    },
    (v) => {
      v[1].unit_amount = 1980;
    },
    (v) => {
      v[0].currency = 'usd';
    },
    (v) => {
      v[0].recurring.interval = 'year';
    },
    (v) => {
      v[1].product.livemode = true;
    },
    (v) => {
      v[0].metadata.novelight_plan = 'premium';
      v[0].product.metadata.novelight_plan = 'premium';
    },
    (v) => {
      v[1].id = v[0].id;
    },
    (v) => {
      v[1].product.id = v[0].product.id;
    },
    (v) => {
      v[1].lookup_key = v[0].lookup_key;
    },
    (v) => {
      v.pop();
    }
  ];
  for (const [index, mutation] of mutations.entries()) {
    const v = pricesFixture();
    mutation(v);
    assert.throws(() => validatePricePair(v), FAIL, String(index));
  }
});

test('Stripe uses GET only, TEST key only, no search results leak', async () => {
  const seen = [];
  const prices = await retrieveStripeTestPrices(
    'sk_test_' + 'a'.repeat(20),
    async (url, options) => {
      seen.push({ url: String(url), options });
      return {
        ok: true,
        json: async () => ({
          object: 'list',
          has_more: false,
          data: pricesFixture()
        })
      };
    }
  );
  assert.equal(seen.length, 1);
  assert.match(seen[0].url, /^https:\/\/api\.stripe\.com\/v1\/prices\?/u);
  assert.equal(seen[0].options.method, 'GET');
  assert.equal(seen[0].options.redirect, 'error');
  assert.equal(prices.standardPriceId, 'price_' + '1'.repeat(20));
  await assert.rejects(
    () =>
      retrieveStripeTestPrices('sk_live_' + 'a'.repeat(20), async () => {
        throw new Error('must not request live Stripe');
      }),
    FAIL
  );
});

test('Supabase verifies STAGING-only privileged credentials read-only', async () => {
  const seen = [];
  assert.equal(
    await verifyStagingAdminKey(
      'sb_secret_' + 'a'.repeat(20),
      async (url, options) => {
        seen.push({ url, options });
        return { ok: true };
      }
    ),
    true
  );
  assert.equal(seen.length, 1);
  assert.match(
    seen[0].url,
    /^https:\/\/wmlzjgvxgoyrovdhbqbg\.supabase\.co\/auth\/v1\/admin\/users/u
  );
  assert.equal(seen[0].options.method, 'GET');
  assert.equal(Object.hasOwn(seen[0].options.headers, 'Authorization'), false);
  await assert.rejects(
    () =>
      verifyStagingAdminKey('sk_live_wrong', async () => {
        throw new Error('must not reach Supabase');
      }),
    FAIL
  );
});

test('only after both verified service credentials and prices may POST four branch values', async () => {
  const posts = [];
  const seen = [];
  const stages = [];
  const result = await provisionAccountDeletionEnv({
    env: credentialsFixture(),
    reportStage: (phase) => stages.push(phase),
    resolveScope: async () => ({
      teamId: 'team_2XFgtRCPJQ6pbrEa4mOLQAEx',
      projectId: 'prj_SmotUNrcyuUntdWTayzWeJ8eQGqe'
    }),
    verifySupabase: async () => {
      seen.push('supabase');
      return true;
    },
    verifyStripe: async () => {
      seen.push('stripe');
      return {
        standardPriceId: 'price_' + '1'.repeat(20),
        premiumPriceId: 'price_' + '2'.repeat(20)
      };
    },
    fetchImpl: async (url, options) => {
      if (options.method === 'GET') {
        return {
          ok: true,
          json: async () => ({ envs: posts.length ? final : initial })
        };
      }
      posts.push(JSON.parse(options.body));
      seen.push('post');
      return { ok: true };
    }
  });
  assert.equal(result.createdKeys.length, 4);
  assert.deepEqual(seen, ['supabase', 'stripe', 'post']);
  assert.deepEqual(stages, [
    'CONTEXT',
    'VERCEL_SCOPE',
    'VERCEL_INVENTORY',
    'SUPABASE_ADMIN',
    'STRIPE_TEST_PRICES',
    'VERCEL_PREVIEW_WRITE',
    'POST_WRITE_VERIFY',
    'COMPLETE'
  ]);
  assert.equal(stages.some((stage) => /sb_secret_|sk_test_|Bearer|price_/.test(stage)), false);
  assert.equal(posts.length, 1);
  assert.deepEqual(
    posts[0].map((v) => v.key),
    final.slice(4).map((v) => v.key)
  );
  assert.equal(
    posts[0].every(
      (v) =>
        v.gitBranch === REF &&
        v.target.join() === 'preview' &&
        v.type === 'sensitive'
    ),
    true
  );
});

test('invalid target, missing protected secret, Stripe failure and partial inventory cause zero mutations', async () => {
  const base = credentialsFixture();
  const cases = [
    { env: { ...base, APPROVED_MAIN_SHA: 'c'.repeat(40) }, input: initial },
    {
      env: {
        ...base,
        STAGING_SUPABASE_URL: 'https://fiepaguycecrredwrcwx.supabase.co'
      },
      input: initial
    },
    { env: base, input: final },
    { env: base, input: initial, scopeWrong: true },
    { env: base, input: initial, stripeFail: true },
    { env: base, input: initial, supabaseFail: true },
    { env: base, input: initial, supabaseFalse: true },
    { env: base, input: initial, stripeWrongIds: true }
  ];
  for (const entry of cases) {
    let post = 0;
    const stages = [];
    await assert.rejects(
      () =>
        provisionAccountDeletionEnv({
          env: entry.env,
          reportStage: (phase) => stages.push(phase),
          resolveScope: async () => ({
            teamId: entry.scopeWrong
              ? 'bad-team'
              : 'team_2XFgtRCPJQ6pbrEa4mOLQAEx',
            projectId: 'prj_SmotUNrcyuUntdWTayzWeJ8eQGqe'
          }),
          verifySupabase: async () => {
            if (entry.supabaseFail)
              throw new Error('secret is not valid for Staging');
            return entry.supabaseFalse ? false : true;
          },
          verifyStripe: async () => {
            if (entry.stripeFail) throw new Error('missing test prices');
            return entry.stripeWrongIds
              ? {
                  standardPriceId: 'price_' + '1'.repeat(20),
                  premiumPriceId: 'price_' + '1'.repeat(20)
                }
              : {
                  standardPriceId: 'price_' + '1'.repeat(20),
                  premiumPriceId: 'price_' + '2'.repeat(20)
                };
          },
          fetchImpl: async (url, options) => {
            if (options.method === 'POST') post += 1;
            return { ok: true, json: async () => ({ envs: entry.input }) };
          }
        }),
      /./u
    );
    assert.equal(post, 0);
    assert.equal(stages.includes('VERCEL_PREVIEW_WRITE'), false);
    assert.equal(stages.every((stage) => ['CONTEXT', 'VERCEL_SCOPE', 'VERCEL_INVENTORY', 'SUPABASE_ADMIN', 'STRIPE_TEST_PRICES'].includes(stage)), true);
  }
});

test('workflow is OWNER ledger-only, protected staging and never Preview/Production', () => {
  const workflow = readFileSync(
    new globalThis.URL(
      '../.github/workflows/account-deletion-staging-env-provision.yml',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(workflow, /issue_comment:/u);
  assert.match(workflow, /issue.number == 188/u);
  assert.match(workflow, /comment.author_association == 'OWNER'/u);
  assert.match(workflow, /ACCOUNT_DELETE_ENV_APPROVE/u);
  assert.match(workflow, /ACCOUNT_DELETE_ENV_CLAIMED/u);
  assert.match(workflow, /ACCOUNT_DELETE_ENV_CONSUMED/u);
  assert.match(workflow, /environment: staging/u);
  assert.match(workflow, /secrets\.STAGING_SUPABASE_SECRET_KEY/u);
  assert.match(workflow, /secrets\.STRIPE_TEST_SECRET_KEY/u);
  assert.match(workflow, /secrets\.VERCEL_API_TOKEN/u);
  assert.doesNotMatch(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /pull_request:\s*\n/u);
  assert.doesNotMatch(workflow, /vercel-preview-deployment\.mjs/u);
  assert.doesNotMatch(workflow, /--prod/u);
});
