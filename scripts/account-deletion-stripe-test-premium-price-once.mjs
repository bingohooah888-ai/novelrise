import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const API = 'https://api.stripe.com';
const LOOKUP = 'novelight_premium_beta_2026_monthly_jpy';
const PRODUCT_NAME = 'NOVELIGHT Premium Beta';
const PRICE_JPY = 480;
const MAX_PAGES = 100;
const PAGE_SIZE = 100;

function deny() {
  throw new Error('STRIPE_TEST_PREMIUM_PRICE_DENIED');
}

function keyIsTestSecret(key) {
  return typeof key === 'string' && /^sk_test_[A-Za-z0-9_]{12,}$/u.test(key);
}

function expectedDigestValid(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

function isStripeObjectId(value, prefix) {
  return (
    typeof value === 'string' &&
    new RegExp('^' + prefix + '[A-Za-z0-9_]{8,}$', 'u').test(value)
  );
}

function verifiedPrice(price, product) {
  return (
    price?.object === 'price' &&
    price?.active === true &&
    price?.livemode === false &&
    price?.lookup_key === LOOKUP &&
    price?.currency === 'jpy' &&
    price?.unit_amount === PRICE_JPY &&
    price?.recurring?.interval === 'month' &&
    price?.recurring?.interval_count === 1 &&
    price?.recurring?.usage_type === 'licensed' &&
    price?.billing_scheme === 'per_unit' &&
    price?.metadata?.novelight_managed === 'true' &&
    price?.metadata?.novelight_plan === 'premium' &&
    price?.metadata?.novelight_beta_price === '480' &&
    typeof price.product === 'string' &&
    product?.id === price.product &&
    product?.object === 'product' &&
    product?.livemode === false &&
    product?.active === true &&
    product?.name === PRODUCT_NAME &&
    product?.metadata?.novelight_managed === 'true' &&
    product?.metadata?.novelight_plan === 'premium' &&
    product?.metadata?.novelight_beta_price === '480'
  );
}

function managedProduct(product) {
  return (
    (typeof product?.name === 'string' &&
      product.name.trim().toLowerCase().includes('novelight premium beta')) ||
    (product?.metadata?.novelight_managed === 'true' &&
      product?.metadata?.novelight_plan === 'premium' &&
      product?.metadata?.novelight_beta_price === '480')
  );
}

function suspectedPrice(price, productIds) {
  const amountMatches =
    price?.currency === 'jpy' &&
    price?.unit_amount === PRICE_JPY &&
    price?.recurring?.interval === 'month' &&
    price?.recurring?.interval_count === 1;
  // Any 480 JPY monthly catalog price is potentially the same beta plan.
  // Prefer a safe stop over creating a duplicate with another lookup key.
  return (
    price?.lookup_key === LOOKUP ||
    productIds.has(price?.product) ||
    amountMatches
  );
}

async function stripeRequest({
  method,
  path,
  key,
  fetchImpl,
  params,
  idempotencyKey
}) {
  if (
    !['GET', 'POST'].includes(method) ||
    !['/v1/account', '/v1/prices', '/v1/products'].includes(path) ||
    (method === 'POST' && path !== '/v1/prices') ||
    (method === 'GET' && idempotencyKey)
  )
    deny();

  const url = new URL(API + path);
  if (method === 'GET' && params) {
    for (const [name, value] of Object.entries(params)) {
      url.searchParams.set(name, String(value));
    }
  }
  if (url.origin !== API || url.username || url.password) deny();

  const headers = { Authorization: 'Bearer ' + key };
  if (method === 'POST') {
    if (!(params instanceof URLSearchParams) || !idempotencyKey) deny();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    headers['Idempotency-Key'] = idempotencyKey;
  }

  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method,
      headers,
      ...(method === 'POST' ? { body: params.toString() } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(12000)
    });
  } catch {
    deny();
  }
  if (!response?.ok || response.status < 200 || response.status >= 300) deny();
  try {
    return await response.json();
  } catch {
    deny();
  }
}

async function enumerate({ endpoint, kind, active, key, fetchImpl }) {
  const items = [];
  const seen = new Set();
  let cursor = null;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const params = { limit: PAGE_SIZE, active };
    if (cursor) params.starting_after = cursor;
    const page = await stripeRequest({
      method: 'GET',
      path: endpoint,
      params,
      key,
      fetchImpl
    });
    if (
      page?.object !== 'list' ||
      typeof page.has_more !== 'boolean' ||
      !Array.isArray(page.data) ||
      page.data.length > PAGE_SIZE
    )
      deny();
    for (const item of page.data) {
      if (
        item?.object !== kind ||
        item?.livemode !== false ||
        item?.active !== active ||
        !isStripeObjectId(item?.id, kind === 'product' ? 'prod_' : 'price_') ||
        seen.has(item.id)
      )
        deny();
      seen.add(item.id);
      items.push(item);
    }
    if (!page.has_more) return items;
    if (page.data.length === 0) deny();
    cursor = page.data.at(-1).id;
  }
  // Never create after an incomplete, capped or malformed catalog scan.
  deny();
}

async function auditCatalog(key, fetchImpl) {
  const products = [
    ...(await enumerate({
      endpoint: '/v1/products',
      kind: 'product',
      active: true,
      key,
      fetchImpl
    })),
    ...(await enumerate({
      endpoint: '/v1/products',
      kind: 'product',
      active: false,
      key,
      fetchImpl
    }))
  ];
  const prices = [
    ...(await enumerate({
      endpoint: '/v1/prices',
      kind: 'price',
      active: true,
      key,
      fetchImpl
    })),
    ...(await enumerate({
      endpoint: '/v1/prices',
      kind: 'price',
      active: false,
      key,
      fetchImpl
    }))
  ];

  if (
    new Set(products.map((p) => p.id)).size !== products.length ||
    new Set(prices.map((p) => p.id)).size !== prices.length
  )
    deny();

  const managed = products.filter(managedProduct);
  const managedIds = new Set(managed.map((p) => p.id));
  const matches = prices.filter((p) => p.lookup_key === LOOKUP);
  const suspects = prices.filter((p) => suspectedPrice(p, managedIds));

  if (managed.length > 1 || matches.length > 1) deny();

  if (matches.length === 1) {
    const product = products.find((p) => p.id === matches[0].product);
    if (
      !verifiedPrice(matches[0], product) ||
      managed.length !== 1 ||
      managed[0].id !== product.id ||
      suspects.length !== 1
    )
      deny();
    return {
      action: 'EXISTS',
      priceId: matches[0].id,
      products: products.length,
      prices: prices.length
    };
  }

  // A similarly marked or inactive price might be a prior attempt. Never
  // silently create a second price or transfer a lookup key.
  if (suspects.length > 0) deny();

  if (managed.length === 1) {
    const product = managed[0];
    if (
      product.active !== true ||
      product.name !== PRODUCT_NAME ||
      product.metadata?.novelight_managed !== 'true' ||
      product.metadata?.novelight_plan !== 'premium' ||
      product.metadata?.novelight_beta_price !== '480' ||
      prices.some((p) => p.product === product.id)
    )
      deny();
    return {
      action: 'REUSE_PRODUCT',
      productId: product.id,
      products: products.length,
      prices: prices.length
    };
  }

  return { action: 'CREATE', products: products.length, prices: prices.length };
}

function formForPrice(productId) {
  const form = new URLSearchParams();
  form.set('currency', 'jpy');
  form.set('unit_amount', String(PRICE_JPY));
  form.set('recurring[interval]', 'month');
  form.set('recurring[interval_count]', '1');
  form.set('lookup_key', LOOKUP);
  form.set('nickname', PRODUCT_NAME + ' monthly JPY');
  form.set('metadata[novelight_managed]', 'true');
  form.set('metadata[novelight_plan]', 'premium');
  form.set('metadata[novelight_beta_price]', '480');
  if (productId) {
    form.set('product', productId);
  } else {
    form.set('product_data[name]', PRODUCT_NAME);
    form.set('product_data[metadata][novelight_managed]', 'true');
    form.set('product_data[metadata][novelight_plan]', 'premium');
    form.set('product_data[metadata][novelight_beta_price]', '480');
  }
  return form;
}

export async function ensureStripeTestPremiumBetaPrice({
  key,
  expectedAccountSha256,
  fetchImpl = globalThis.fetch,
  permitSingleWrite = false
}) {
  if (
    !keyIsTestSecret(key) ||
    !expectedDigestValid(expectedAccountSha256) ||
    typeof fetchImpl !== 'function'
  )
    deny();

  const account = await stripeRequest({
    method: 'GET',
    path: '/v1/account',
    key,
    fetchImpl
  });
  if (
    account?.object !== 'account' ||
    !isStripeObjectId(account.id, 'acct_') ||
    account.livemode === true
  )
    deny();
  const current = createHash('sha256').update(account.id, 'utf8').digest();
  const expected = Buffer.from(expectedAccountSha256, 'hex');
  if (!timingSafeEqual(current, expected)) deny();

  const audit = await auditCatalog(key, fetchImpl);
  if (audit.action === 'EXISTS') {
    return Object.freeze({
      result: 'EXISTING_VALID_PRICE',
      accountMatch: true,
      created: false,
      productsAudited: audit.products,
      pricesAudited: audit.prices
    });
  }
  if (!permitSingleWrite) {
    return Object.freeze({
      result: 'NEEDS_APPROVED_WRITE',
      accountMatch: true,
      created: false,
      productsAudited: audit.products,
      pricesAudited: audit.prices
    });
  }

  const idempotencyKey =
    'novelight-issue82-premium-test-480-v1-' +
    expectedAccountSha256.slice(0, 32);
  const created = await stripeRequest({
    method: 'POST',
    path: '/v1/prices',
    key,
    fetchImpl,
    params: formForPrice(audit.productId ?? null),
    idempotencyKey
  });

  if (
    !isStripeObjectId(created?.id, 'price_') ||
    created?.object !== 'price' ||
    created?.livemode !== false ||
    created?.active !== true ||
    created?.lookup_key !== LOOKUP ||
    created?.currency !== 'jpy' ||
    created?.unit_amount !== PRICE_JPY ||
    created?.recurring?.interval !== 'month' ||
    created?.recurring?.interval_count !== 1 ||
    created?.metadata?.novelight_plan !== 'premium' ||
    created?.metadata?.novelight_managed !== 'true' ||
    !isStripeObjectId(created?.product, 'prod_')
  )
    deny();

  // Final authoritative scan; an uncertain write is never retried here.
  const verified = await auditCatalog(key, fetchImpl);
  if (verified.action !== 'EXISTS' || verified.priceId !== created.id) deny();

  return Object.freeze({
    result: 'CREATED_AND_VERIFIED',
    accountMatch: true,
    created: true,
    productsAudited: verified.products,
    pricesAudited: verified.prices
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const safeRun =
    process.argv.length === 3 &&
    process.argv[2] === '--approved-once' &&
    process.env.GITHUB_ACTIONS === 'true' &&
    process.env.GITHUB_EVENT_NAME === 'issue_comment' &&
    process.env.GITHUB_REPOSITORY === 'bingohooah888-ai/novelrise' &&
    process.env.GITHUB_REF === 'refs/heads/main' &&
    process.env.GITHUB_RUN_ATTEMPT === '1';
  if (!safeRun) {
    console.error('STRIPE_TEST_PREMIUM_PRICE_DENIED');
    process.exitCode = 1;
  } else {
    ensureStripeTestPremiumBetaPrice({
      key: process.env.STRIPE_TEST_SECRET_KEY,
      expectedAccountSha256: process.env.STRIPE_TEST_EXPECTED_ACCOUNT_SHA256,
      permitSingleWrite: true
    })
      .then((out) => {
        console.log('STRIPE_TEST_PREMIUM_PRICE_ONCE ' + JSON.stringify(out));
      })
      .catch(() => {
        // A failed or uncertain POST is never retried automatically. Never
        // print raw errors, credentials, account/customer/product/price IDs.
        console.error('STRIPE_TEST_PREMIUM_PRICE_DENIED');
        process.exitCode = 1;
      });
  }
}
