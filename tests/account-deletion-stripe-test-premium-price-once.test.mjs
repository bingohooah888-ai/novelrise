import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { ensureStripeTestPremiumBetaPrice } from '../scripts/account-deletion-stripe-test-premium-price-once.mjs';
import { admitStripeTestPremiumPriceOnce } from '../scripts/account-deletion-stripe-test-premium-price-admission.mjs';
import { REVIEWED_FILES } from '../scripts/account-deletion-preview-admission.mjs';

const ACCOUNT = 'acct_' + 'A'.repeat(20);
const WRONG_ACCOUNT = 'acct_' + 'B'.repeat(20);
const DIGEST = createHash('sha256').update(ACCOUNT).digest('hex');
const KEY = 'sk_test_' + 'x'.repeat(30);
const LOOKUP = 'novelight_premium_beta_2026_monthly_jpy';
const NAME = 'NOVELIGHT Premium Beta';
const OWNER = 'bingohooah888-ai';
const REPO = OWNER + '/novelrise';
const MAIN = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const PREFIX = 'NOVELIGHT_STRIPE_TEST_PREMIUM_PRICE_APPROVE ';
const META = Object.freeze({
  novelight_managed: 'true',
  novelight_plan: 'premium',
  novelight_beta_price: '480'
});

function product(id = 'prod_' + 'p'.repeat(20), overrides = {}) {
  return {
    id,
    object: 'product',
    active: true,
    livemode: false,
    name: NAME,
    metadata: { ...META },
    ...overrides
  };
}

function price(id, productId, overrides = {}) {
  return {
    id,
    object: 'price',
    active: true,
    livemode: false,
    lookup_key: LOOKUP,
    product: productId,
    currency: 'jpy',
    unit_amount: 480,
    billing_scheme: 'per_unit',
    recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
    metadata: { ...META },
    ...overrides
  };
}

function ok(value) {
  return {
    ok: true,
    status: 200,
    json: async () => globalThis.structuredClone(value)
  };
}

function catalogFixture({
  account = ACCOUNT,
  products = [],
  prices = [],
  pageSize = 100,
  breakListing = false,
  failPost = false
} = {}) {
  const state = {
    products: globalThis.structuredClone(products),
    prices: globalThis.structuredClone(prices)
  };
  const calls = [];
  async function fetchImpl(url, options) {
    const request = new globalThis.URL(url);
    calls.push({
      pathname: request.pathname,
      method: options.method,
      url,
      options
    });
    assert.equal(request.origin, 'https://api.stripe.com');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer ' + KEY);

    if (options.method === 'GET' && request.pathname === '/v1/account') {
      return ok({ object: 'account', id: account, livemode: false });
    }
    if (
      options.method === 'GET' &&
      ['/v1/prices', '/v1/products'].includes(request.pathname)
    ) {
      const collection =
        request.pathname === '/v1/products' ? state.products : state.prices;
      const active = request.searchParams.get('active');
      assert.ok(active === 'true' || active === 'false');
      const selected = collection.filter(
        (item) => String(item.active) === active
      );
      const after = request.searchParams.get('starting_after');
      const index = after
        ? selected.findIndex((item) => item.id === after) + 1
        : 0;
      if (after) assert.ok(index > 0);
      const slice = selected.slice(index, index + pageSize);
      return ok({
        object: 'list',
        data: slice,
        has_more: breakListing || index + pageSize < selected.length
      });
    }
    if (options.method === 'POST' && request.pathname === '/v1/prices') {
      if (failPost) throw new Error('never leak credential ' + KEY);
      const form = new globalThis.URLSearchParams(options.body);
      assert.equal(
        options.headers['Content-Type'],
        'application/x-www-form-urlencoded'
      );
      assert.match(
        options.headers['Idempotency-Key'],
        /^novelight-issue82-premium-test-480-v1-/u
      );
      assert.equal(form.get('lookup_key'), LOOKUP);
      assert.equal(form.get('currency'), 'jpy');
      assert.equal(form.get('unit_amount'), '480');
      assert.equal(form.get('recurring[interval]'), 'month');
      assert.equal(form.get('recurring[interval_count]'), '1');
      assert.equal(form.get('metadata[novelight_managed]'), 'true');
      assert.equal(form.get('metadata[novelight_plan]'), 'premium');
      assert.equal(form.get('metadata[novelight_beta_price]'), '480');
      assert.equal(form.has('transfer_lookup_key'), false);
      let pId = form.get('product');
      if (!pId) {
        assert.equal(form.get('product_data[name]'), NAME);
        assert.equal(
          form.get('product_data[metadata][novelight_plan]'),
          'premium'
        );
        pId = 'prod_' + 'z'.repeat(20);
        state.products.unshift(product(pId));
      }
      const item = price('price_' + 'w'.repeat(20), pId);
      state.prices.unshift(item);
      return ok(item);
    }
    throw new Error('unexpected test request');
  }
  const run = (overrides = {}) =>
    ensureStripeTestPremiumBetaPrice({
      key: KEY,
      expectedAccountSha256: DIGEST,
      fetchImpl,
      permitSingleWrite: true,
      ...overrides
    });
  return { state, calls, fetchImpl, run };
}

function postCount(f) {
  return f.calls.filter((x) => x.method === 'POST').length;
}

test('empty TEST catalog creates exactly one Premium 480 JPY monthly price and verifies it', async () => {
  const f = catalogFixture();
  const result = await f.run();
  assert.equal(result.result, 'CREATED_AND_VERIFIED');
  assert.equal(result.created, true);
  assert.equal(result.accountMatch, true);
  assert.equal(postCount(f), 1);
  assert.equal(f.state.products.length, 1);
  assert.equal(f.state.prices.length, 1);
  assert.equal(f.calls[0].pathname, '/v1/account');
  assert.ok(f.calls.slice(1).every((c) => c.pathname !== '/v1/account'));
  assert.ok(
    f.calls
      .filter((c) => c.method === 'GET' && c.pathname === '/v1/prices')
      .some((c) => c.url.includes('active=false'))
  );
  assert.ok(
    f.calls
      .filter((c) => c.method === 'GET' && c.pathname === '/v1/products')
      .some((c) => c.url.includes('active=false'))
  );
  assert.ok(
    f.calls
      .filter((c) => c.method === 'POST')
      .every((c) => c.pathname === '/v1/prices')
  );
  assert.doesNotMatch(JSON.stringify(result), /acct_|sk_test_|prod_|price_/u);
});

test('existing correctly configured Premium beta price is a no-op', async () => {
  const p = product();
  const f = catalogFixture({
    products: [p],
    prices: [price('price_' + 'a'.repeat(20), p.id)]
  });
  const out = await f.run();
  assert.equal(out.result, 'EXISTING_VALID_PRICE');
  assert.equal(out.created, false);
  assert.equal(postCount(f), 0);
});

test('approved write is required even for an empty TEST catalog', async () => {
  const f = catalogFixture();
  const out = await f.run({ permitSingleWrite: false });
  assert.equal(out.result, 'NEEDS_APPROVED_WRITE');
  assert.equal(postCount(f), 0);
});

test('existing canonical managed product without prices is reused, not duplicated', async () => {
  const p = product();
  const f = catalogFixture({ products: [p] });
  const out = await f.run();
  assert.equal(out.result, 'CREATED_AND_VERIFIED');
  assert.equal(f.state.products.length, 1);
  assert.equal(f.state.prices[0].product, p.id);
  assert.equal(postCount(f), 1);
});

test('inactive lookup, wrong amounts, overlapping 480 JPY price and duplicate product all deny', async () => {
  const canonical = product();
  const cases = [
    {
      products: [canonical],
      prices: [
        price('price_' + 'a'.repeat(20), canonical.id, { active: false })
      ]
    },
    {
      products: [canonical],
      prices: [
        price('price_' + 'a'.repeat(20), canonical.id, { unit_amount: 490 })
      ]
    },
    {
      products: [canonical],
      prices: [
        price('price_' + 'a'.repeat(20), canonical.id, {
          lookup_key: 'another_lookup',
          active: false
        })
      ]
    },
    {
      products: [product('prod_' + 'x'.repeat(20), { name: 'Other' })],
      prices: [
        price('price_' + 'x'.repeat(20), 'prod_' + 'x'.repeat(20), {
          lookup_key: 'another_lookup'
        })
      ]
    },
    { products: [canonical, product('prod_' + 'b'.repeat(20))] }
  ];
  for (const config of cases) {
    const f = catalogFixture(config);
    await assert.rejects(f.run(), /STRIPE_TEST_PREMIUM_PRICE_DENIED/u);
    assert.equal(postCount(f), 0);
  }
});

test('wrong account, live keys and invalid digest deny without catalog reads or writes', async () => {
  const f = catalogFixture({ account: WRONG_ACCOUNT });
  await assert.rejects(f.run(), /STRIPE_TEST_PREMIUM_PRICE_DENIED/u);
  assert.deepEqual(
    f.calls.map((x) => x.pathname),
    ['/v1/account']
  );
  for (const config of [
    { key: 'sk_live_' + 'x'.repeat(25) },
    { key: 'rk_test_' + 'x'.repeat(25) },
    { expectedAccountSha256: 'bad' }
  ]) {
    const g = catalogFixture();
    await assert.rejects(g.run(config), /STRIPE_TEST_PREMIUM_PRICE_DENIED/u);
    assert.equal(g.calls.length, 0);
  }
});

test('pagination must exhaust active and inactive records before one write', async () => {
  const foreignProducts = Array.from({ length: 112 }, (_, i) =>
    product('prod_' + String(i).padStart(12, '0'), {
      name: 'Other ' + i,
      metadata: {}
    })
  );
  const f = catalogFixture({ products: foreignProducts });
  const result = await f.run();
  assert.equal(result.result, 'CREATED_AND_VERIFIED');
  assert.ok(
    f.calls.some(
      (x) => x.pathname === '/v1/products' && x.url.includes('starting_after=')
    )
  );
  assert.equal(postCount(f), 1);
  assert.equal(f.state.products.length, 113);

  const broken = catalogFixture({ breakListing: true });
  await assert.rejects(broken.run(), /STRIPE_TEST_PREMIUM_PRICE_DENIED/u);
  assert.equal(postCount(broken), 0);
});

test('uncertain POST is never retried and error message does not expose credentials', async () => {
  const f = catalogFixture({ failPost: true });
  await assert.rejects(f.run(), (e) => {
    assert.equal(e.message, 'STRIPE_TEST_PREMIUM_PRICE_DENIED');
    assert.doesNotMatch(e.message, /sk_test_|acct_/u);
    return true;
  });
  assert.equal(postCount(f), 1);
});

test('malformed TEST data or a live object denies before any write', async () => {
  const f = catalogFixture({
    products: [product(undefined, { livemode: true })]
  });
  await assert.rejects(f.run(), /STRIPE_TEST_PREMIUM_PRICE_DENIED/u);
  assert.equal(postCount(f), 0);
});

function admissionFixture() {
  const issue = {
    id: 422,
    number: 188,
    url: 'https://api.github.com/repos/' + REPO + '/issues/188',
    title: '[Staging Approval Control] Preview / Staging cost gate',
    state: 'open',
    locked: false,
    user: { login: OWNER }
  };
  const body =
    PREFIX +
    JSON.stringify({
      scope: 'account-82-stripe-test-premium-beta-price-once',
      mainSha: MAIN,
      candidateSha: HEAD,
      confirmation: 'STAGING TEST PRICE WRITE APPROVED'
    });
  const event = {
    repository: { full_name: REPO },
    issue: { ...issue },
    comment: {
      id: 911,
      body,
      user: { login: OWNER, id: 317436651 },
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
      files: REVIEWED_FILES.map((file) => ({
        filename: file.path,
        status: file.status,
        sha: file.sha
      }))
    },
    ledgerPages: [[{ id: 911, body }]]
  };
}

test('admission accepts only an exact one-time OWNER grant for the immutable seven-file PR', () => {
  const grant = admitStripeTestPremiumPriceOnce(admissionFixture());
  assert.deepEqual(grant, {
    mainSha: MAIN,
    candidateSha: HEAD,
    approvalCommentId: '911'
  });
});

test('admission denies non-OWNER, drifted SHA and unreviewed account fix blob', () => {
  const mutations = [
    (a) => {
      a.event.comment.user.login = 'another';
    },
    (a) => {
      a.event.comment.user.id = 12345;
    },
    (a) => {
      a.mainRef.object.sha = 'f'.repeat(40);
    },
    (a) => {
      a.pr.head.sha = 'f'.repeat(40);
    },
    (a) => {
      a.pr.draft = false;
    },
    (a) => {
      a.compare.files[0].sha = 'f'.repeat(40);
    },
    (a) => {
      a.compare.files.push({ filename: 'other', sha: 'd' });
    },
    (a) => {
      a.event.comment.body += ' ';
    },
    (a) => {
      a.issue.locked = true;
    },
    (a) => {
      a.ledgerPages = [[{ id: 911, body: 'tampered' }]];
    }
  ];
  for (const alter of mutations) {
    const data = admissionFixture();
    alter(data);
    assert.throws(
      () => admitStripeTestPremiumPriceOnce(data),
      /STRIPE_TEST_PREMIUM_PRICE_ADMISSION_DENIED/u
    );
  }
});

test('admission rejects used grants and incomplete or missing ledger pages', () => {
  for (const prefix of [
    'NOVELIGHT_STRIPE_TEST_PREMIUM_PRICE_CLAIMED ',
    'NOVELIGHT_STRIPE_TEST_PREMIUM_PRICE_CONSUMED '
  ]) {
    const data = admissionFixture();
    data.ledgerPages[0].push({
      body:
        prefix +
        JSON.stringify({
          requestCommentId: '911',
          mainSha: MAIN,
          candidateSha: HEAD,
          runId: '123',
          ...(prefix.includes('CONSUMED') ? { result: 'success' } : {})
        })
    });
    assert.throws(() => admitStripeTestPremiumPriceOnce(data));
  }
  const data = admissionFixture();
  data.ledgerPages[0] = Array.from({ length: 100 }, (_, i) => ({
    id: 911 + i,
    body: i === 0 ? data.event.comment.body : 'other'
  }));
  assert.throws(() => admitStripeTestPremiumPriceOnce(data));
});

test('workflow has no automatic branch, PR, dispatch, or direct Production trigger', () => {
  const workflow = readFileSync(
    new globalThis.URL(
      '../.github/workflows/account-deletion-stripe-test-premium-price-once.yml',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(workflow, /issue_comment:/u);
  assert.doesNotMatch(
    workflow,
    /^\s+(?:push|pull_request|workflow_dispatch|schedule):/mu
  );
  assert.match(workflow, /environment: staging/u);
  assert.match(workflow, /github.run_attempt == 1/u);
  assert.match(workflow, /NOVELIGHT_STRIPE_TEST_PREMIUM_PRICE_APPROVE/u);
  assert.match(workflow, /STRIPE_TEST_EXPECTED_ACCOUNT_SHA256/u);
  assert.doesNotMatch(workflow, /sk_live_|production-approval/u);
});
