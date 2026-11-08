import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  inspectStripeTestSandbox,
  httpClass
} from '../scripts/account-deletion-stripe-test-identity-readonly.mjs';
import { admitStripeSandboxDiagnostic } from '../scripts/account-deletion-stripe-test-diagnostic-admission.mjs';
import { REVIEWED_FILES } from '../scripts/account-deletion-preview-admission.mjs';

const OWNER = 'bingohooah888-ai';
const REPO = OWNER + '/novelrise';
const MAIN = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const ACCOUNT = 'acct_' + 'C'.repeat(20);
const KEY = 'sk_test_' + 'x'.repeat(25);
const DIGEST = createHash('sha256').update(ACCOUNT).digest('hex');
const PREFIX = 'NOVELIGHT_STRIPE_SANDBOX_READONLY_APPROVE ';

function apiResponse(status, jsonValue) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => jsonValue
  };
}

function stripeFixture({
  accountId = ACCOUNT,
  accountStatus = 200,
  pricesStatus = 200,
  priceList = [],
  pricesHasMore = false
} = {}) {
  const requests = [];
  async function fetchImpl(url, opts) {
    const path = new URL(url).pathname;
    requests.push({ path, url: String(url), opts });
    if (path === '/v1/account') {
      return apiResponse(accountStatus, {
        object: 'account',
        id: accountId,
        email: 'never-log@example.com'
      });
    }
    if (path === '/v1/prices') {
      return apiResponse(pricesStatus, {
        object: 'list',
        has_more: pricesHasMore,
        data: priceList
      });
    }
    throw new Error('Unexpected endpoint');
  }
  return { fetchImpl, requests };
}

function price(lookup) {
  return {
    id: 'price_' + 'n'.repeat(20),
    object: 'price',
    lookup_key: lookup,
    active: true,
    livemode: false,
    metadata: { confidential: 'never-log-this' }
  };
}
const STANDARD = 'novelight_standard_monthly_jpy';
const PREMIUM = 'novelight_premium_beta_2026_monthly_jpy';

function grantFixture() {
  const issue = {
    id: 422,
    number: 188,
    title: '[Staging Approval Control] Preview / Staging cost gate',
    url: 'https://api.github.com/repos/' + REPO + '/issues/188',
    state: 'open',
    locked: false,
    user: { login: OWNER }
  };
  const body =
    PREFIX +
    JSON.stringify({
      scope: 'stripe-sandbox-identity-readonly',
      mainSha: MAIN,
      candidateSha: HEAD,
      confirmation: 'STAGING READONLY APPROVED'
    });
  const event = {
    repository: { full_name: REPO },
    issue: { ...issue },
    comment: {
      id: 933,
      body,
      user: { login: OWNER },
      author_association: 'OWNER'
    }
  };
  return {
    event,
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
      head: {
        ref: 'fix/inquiry-82-account-deletion-diagnostics-20261107',
        sha: HEAD,
        repo: { full_name: REPO }
      }
    },
    compare: {
      status: 'ahead',
      behind_by: 0,
      ahead_by: 2,
      total_commits: 2,
      base_commit: { sha: MAIN },
      commits: [{ sha: 'c'.repeat(40) }, { sha: HEAD }],
      files: REVIEWED_FILES.map((f) => ({
        filename: f.path,
        sha: f.sha,
        status: f.status
      }))
    },
    ledgerPages: [[{ body: 'unrelated' }]]
  };
}

test('only GET two immutable Stripe endpoints, only after account digest matches', async () => {
  const f = stripeFixture({ priceList: [price(STANDARD), price(PREMIUM)] });
  const got = await inspectStripeTestSandbox({
    key: KEY,
    expectedAccountSha256: DIGEST,
    fetchImpl: f.fetchImpl
  });
  assert.deepEqual(got, {
    accountMatch: true,
    standardCount: 1,
    premiumBetaCount: 1,
    accountStatus: 'HTTP_2XX',
    pricesStatus: 'HTTP_2XX'
  });
  assert.deepEqual(
    f.requests.map((x) => x.path),
    ['/v1/account', '/v1/prices']
  );
  assert.equal(
    f.requests.every((x) => x.opts.method === 'GET'),
    true
  );
  assert.equal(
    f.requests.every((x) => x.opts.redirect === 'error'),
    true
  );
  assert.equal(
    f.requests.every((x) => x.url.startsWith('https://api.stripe.com/')),
    true
  );
  assert.equal(f.requests[1].url.includes('lookup_keys%5B%5D'), true);
  assert.equal(f.requests[1].url.includes('active=true'), true);
});

test('mismatched account ends after GET account, never enumerates another sandbox prices', async () => {
  const f = stripeFixture({ accountId: 'acct_' + 'D'.repeat(20) });
  const got = await inspectStripeTestSandbox({
    key: KEY,
    expectedAccountSha256: DIGEST,
    fetchImpl: f.fetchImpl
  });
  assert.deepEqual(got, {
    accountMatch: false,
    standardCount: null,
    premiumBetaCount: null,
    accountStatus: 'HTTP_2XX',
    pricesStatus: 'NOT_REQUESTED'
  });
  assert.deepEqual(
    f.requests.map((x) => x.path),
    ['/v1/account']
  );
});

test('no matching products returns two zero counts, duplicate lookups are counted', async () => {
  for (const [prices, counts] of [
    [[], [0, 0]],
    [
      [price(STANDARD), price(STANDARD), price(PREMIUM)],
      [2, 1]
    ]
  ]) {
    const f = stripeFixture({ priceList: prices });
    const got = await inspectStripeTestSandbox({
      key: KEY,
      expectedAccountSha256: DIGEST,
      fetchImpl: f.fetchImpl
    });
    assert.deepEqual([got.standardCount, got.premiumBetaCount], counts);
  }
});

test('LIVE, publishable, malformed key or missing trusted SHA256 deny before any request', async () => {
  for (const [key, digest] of [
    ['sk_live_' + 'x'.repeat(20), DIGEST],
    ['rk_live_' + 'x'.repeat(20), DIGEST],
    ['pk_test_' + 'x'.repeat(20), DIGEST],
    ['sk_test_abc', DIGEST],
    [KEY, 'bad'],
    [KEY, '']
  ]) {
    const f = stripeFixture();
    const got = await inspectStripeTestSandbox({
      key,
      expectedAccountSha256: digest,
      fetchImpl: f.fetchImpl
    });
    assert.equal(got.accountMatch, null);
    assert.equal(got.accountStatus, 'INVALID_CONFIGURATION');
    assert.equal(f.requests.length, 0);
  }
});

test('restricted test key may read, but cannot bypass HTTP permissions', async () => {
  const f = stripeFixture({ accountStatus: 403 });
  const got = await inspectStripeTestSandbox({
    key: 'rk_test_' + 'q'.repeat(25),
    expectedAccountSha256: DIGEST,
    fetchImpl: f.fetchImpl
  });
  assert.equal(got.accountStatus, 'HTTP_403');
  assert.equal(got.accountMatch, null);
  assert.equal(f.requests.length, 1);
});

test('HTTP 401/403/429/5xx and network errors produce safe classes, never body strings', async () => {
  for (const [status, expected] of [
    [401, 'HTTP_401'],
    [403, 'HTTP_403'],
    [429, 'HTTP_429'],
    [503, 'HTTP_5XX']
  ]) {
    const f = stripeFixture({ accountStatus: status });
    const got = await inspectStripeTestSandbox({
      key: KEY,
      expectedAccountSha256: DIGEST,
      fetchImpl: f.fetchImpl
    });
    assert.equal(got.accountStatus, expected);
    assert.equal(got.pricesStatus, 'NOT_REQUESTED');
    assert.doesNotMatch(JSON.stringify(got), /never-log|acct_|sk_test_|price_/);
  }
  const got = await inspectStripeTestSandbox({
    key: KEY,
    expectedAccountSha256: DIGEST,
    fetchImpl: async () => {
      throw new Error('token=' + KEY);
    }
  });
  assert.equal(got.accountStatus, 'NETWORK_FAILURE');
  assert.doesNotMatch(JSON.stringify(got), /sk_test_/);
});

test('matched account but prices API error never emits body, ID or price data', async () => {
  const f = stripeFixture({ pricesStatus: 403 });
  const got = await inspectStripeTestSandbox({
    key: KEY,
    expectedAccountSha256: DIGEST,
    fetchImpl: f.fetchImpl
  });
  assert.deepEqual(got, {
    accountMatch: true,
    standardCount: null,
    premiumBetaCount: null,
    accountStatus: 'HTTP_2XX',
    pricesStatus: 'HTTP_403'
  });
});

test('malformed or live price records and unexpected pagination fail safely', async () => {
  const cases = [
    { priceList: [{ ...price(STANDARD), livemode: true }] },
    { priceList: [{ ...price(STANDARD), lookup_key: 'foreign_key' }] },
    { priceList: [price(STANDARD)], pricesHasMore: true }
  ];
  for (const fixture of cases) {
    const f = stripeFixture(fixture);
    const got = await inspectStripeTestSandbox({
      key: KEY,
      expectedAccountSha256: DIGEST,
      fetchImpl: f.fetchImpl
    });
    assert.equal(got.accountMatch, true);
    assert.equal(got.pricesStatus, 'INVALID_RESPONSE');
    assert.equal(got.standardCount, null);
  }
});

test('only exact OWNER, open #188, reviewed seven blobs, latest main and unused grant admit', () => {
  assert.deepEqual(admitStripeSandboxDiagnostic(grantFixture()), {
    mainSha: MAIN,
    candidateSha: HEAD,
    approvalCommentId: '933'
  });
  const mutators = [
    (f) => {
      f.issue.state = 'closed';
    },
    (f) => {
      f.issue.locked = true;
    },
    (f) => {
      f.event.issue.number = 187;
    },
    (f) => {
      f.event.comment.user.login = 'attacker';
    },
    (f) => {
      f.event.comment.author_association = 'CONTRIBUTOR';
    },
    (f) => {
      f.event.comment.body = 'NOVELIGHT_STAGING_ACCOUNT_DELETE_ENV_APPROVE {}';
    },
    (f) => {
      f.mainRef.object.sha = 'd'.repeat(40);
    },
    (f) => {
      f.checkedOutSha = 'd'.repeat(40);
    },
    (f) => {
      f.pr.base.sha = 'd'.repeat(40);
    },
    (f) => {
      f.pr.head.sha = 'd'.repeat(40);
    },
    (f) => {
      f.pr.head.repo.full_name = 'evil/fork';
    },
    (f) => {
      f.pr.draft = false;
    },
    (f) => {
      f.compare.behind_by = 1;
    },
    (f) => {
      f.compare.files[0].sha = 'd'.repeat(40);
    },
    (f) => {
      f.compare.files.push({ filename: 'unreviewed.js' });
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
              'NOVELIGHT_STRIPE_SANDBOX_READONLY_CLAIMED ' +
              JSON.stringify({
                requestCommentId: '933',
                mainSha: MAIN,
                candidateSha: HEAD,
                runId: '11'
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
              'NOVELIGHT_STRIPE_SANDBOX_READONLY_CONSUMED ' +
              JSON.stringify({
                requestCommentId: '933',
                mainSha: MAIN,
                candidateSha: HEAD,
                runId: '11',
                result: 'failure'
              })
          }
        ]
      ];
    }
  ];
  for (const [n, fn] of mutators.entries()) {
    const f = grantFixture();
    fn(f);
    assert.throws(
      () => admitStripeSandboxDiagnostic(f),
      /STRIPE_SANDBOX_DIAGNOSTIC_ADMISSION_DENIED/,
      String(n)
    );
  }
});

test('workflow uses protected staging and unique OWNER ledger, never preview or billing writes', () => {
  const workflow = readFileSync(
    new URL(
      '../.github/workflows/account-deletion-stripe-test-identity-readonly.yml',
      import.meta.url
    ),
    'utf8'
  );
  const probe = readFileSync(
    new URL(
      '../scripts/account-deletion-stripe-test-identity-readonly.mjs',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(workflow, /issue_comment:/);
  assert.match(workflow, /comment\.author_association == 'OWNER'/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /secrets\.STRIPE_TEST_SECRET_KEY/);
  assert.match(workflow, /vars\.STRIPE_TEST_EXPECTED_ACCOUNT_SHA256/);
  assert.match(workflow, /STRIPE_SANDBOX_READONLY_CLAIMED/);
  assert.match(workflow, /STRIPE_SANDBOX_READONLY_CONSUMED/);
  assert.doesNotMatch(
    workflow,
    /workflow_dispatch:|pull_request:\s*\n|schedule:/
  );
  assert.doesNotMatch(
    workflow,
    /vercel deploy|vercel-preview|stripe prices create/i
  );
  assert.doesNotMatch(
    probe,
    /method:\s*'POST'|method:\s*'DELETE'|\/v1\/customers|\/v1\/payment_intents/u
  );
});

test('safe HTTP status classification never surfaces numeric unknown or request contents', () => {
  assert.equal(httpClass(200), 'HTTP_2XX');
  assert.equal(httpClass(400), 'HTTP_4XX');
  assert.equal(httpClass(502), 'HTTP_5XX');
  assert.equal(httpClass(NaN), 'HTTP_UNKNOWN');
});
