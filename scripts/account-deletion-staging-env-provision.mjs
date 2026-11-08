import { pathToFileURL } from 'node:url';
import { resolveVercelProjectScope } from './vercel-admin-allowlist.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const PROJECT = 'novelrise';
const PROJECT_ID = 'prj_SmotUNrcyuUntdWTayzWeJ8eQGqe';
const TEAM_ID = 'team_2XFgtRCPJQ6pbrEa4mOLQAEx';
const STAGING_URL = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
const FIX_BRANCH = 'fix/inquiry-82-account-deletion-diagnostics-20261107';
const SHA = /^[a-f0-9]{40}$/u;
const PRICE_ID = /^price_[A-Za-z0-9]{10,}$/u;
const PRESENT = Object.freeze([
  'SUPABASE_URL',
  'NOVELIGHT_STAGING_SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY'
]);
const FREE_MISSING = Object.freeze(['SUPABASE_SECRET_KEY', 'STRIPE_SECRET_KEY']);
const MISSING = Object.freeze([
  'SUPABASE_SECRET_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_STANDARD_PRICE_ID',
  'STRIPE_PREMIUM_PRICE_ID'
]);
const PLANS = Object.freeze([
  { key: 'standard', lookup: 'novelight_standard_monthly_jpy', amount: 980 },
  {
    key: 'premium',
    lookup: 'novelight_premium_beta_2026_monthly_jpy',
    amount: 480
  }
]);

function fail(code) {
  throw new Error('ACCOUNT_ENV_PROVISION_' + code);
}
function requireSafeResponse(response) {
  if (!response?.ok) fail('REMOTE_REQUEST_REJECTED');
  return response;
}
function noPagination(payload) {
  if (payload?.pagination?.next != null || !Array.isArray(payload?.envs)) {
    fail('ENV_INVENTORY_INCOMPLETE');
  }
  return payload.envs;
}
function exactlyOneBranchValue(all, key) {
  const entries = all.filter((item) => item.key === key);
  if (entries.length !== 1) fail('ENV_SCOPE_DRIFT');
  const [item] = entries;
  if (
    item.gitBranch !== FIX_BRANCH ||
    !Array.isArray(item.target) ||
    item.target.length !== 1 ||
    item.target[0] !== 'preview'
  ) {
    fail('ENV_SCOPE_DRIFT');
  }
  return item;
}

export function assertProvisioningInventory(
  envs,
  stage = 'before',
  mode = 'standard'
) {
  if (
    !Array.isArray(envs) ||
    !['before', 'after'].includes(stage) ||
    !['standard', 'free'].includes(mode)
  ) {
    fail('ENV_SCOPE_DRIFT');
  }
  const branchOnly = envs.filter((item) => item?.gitBranch === FIX_BRANCH);
  const expected =
    stage === 'before'
      ? PRESENT
      : [...PRESENT, ...(mode === 'free' ? FREE_MISSING : MISSING)];
  if (
    branchOnly.length !== expected.length ||
    branchOnly.some((item) => !expected.includes(item.key))
  ) {
    fail('ENV_SCOPE_DRIFT');
  }
  for (const key of expected) {
    const item = exactlyOneBranchValue(branchOnly, key);
    if (key.endsWith('_URL')) {
      if (item.type !== 'plain' || item.value !== STAGING_URL) {
        fail('STAGING_TARGET_MISMATCH');
      }
    } else if (item.type !== 'sensitive' && item.type !== 'encrypted') {
      fail('ENV_SCOPE_DRIFT');
    }
  }
  return { target: FIX_BRANCH, configuredKeys: expected.length };
}

export function validatePricePair(prices) {
  if (!Array.isArray(prices) || prices.length !== PLANS.length) {
    fail('STRIPE_TEST_PRICES_MISSING');
  }
  const selected = [];
  for (const plan of PLANS) {
    const found = prices.filter((price) => price?.lookup_key === plan.lookup);
    if (found.length !== 1) fail('STRIPE_TEST_PRICES_AMBIGUOUS');
    const p = found[0];
    const product = p.product;
    if (
      !PRICE_ID.test(p.id || '') ||
      p.object !== 'price' ||
      p.livemode !== false ||
      p.active !== true ||
      p.currency !== 'jpy' ||
      p.unit_amount !== plan.amount ||
      p.type !== 'recurring' ||
      p.recurring?.interval !== 'month' ||
      p.recurring?.interval_count !== 1 ||
      p.recurring?.usage_type !== 'licensed' ||
      !product ||
      typeof product !== 'object' ||
      product.object !== 'product' ||
      product.livemode !== false ||
      product.active !== true ||
      !/^prod_[A-Za-z0-9]+$/u.test(product.id || '') ||
      (p.metadata?.novelight_plan !== plan.key &&
        product.metadata?.novelight_plan !== plan.key) ||
      (p.metadata?.novelight_managed !== 'true' &&
        product.metadata?.novelight_managed !== 'true')
    ) {
      fail('STRIPE_TEST_PRICE_NOT_VERIFIED');
    }
    selected.push({ role: plan.key, id: p.id, productId: product.id });
  }
  if (
    selected[0].id === selected[1].id ||
    selected[0].productId === selected[1].productId
  ) {
    fail('STRIPE_TEST_PRICES_NOT_DISTINCT');
  }
  return {
    standardPriceId: selected[0].id,
    premiumPriceId: selected[1].id
  };
}

export async function retrieveStripeTestPrices(secret, fetchImpl) {
  if (!/^sk_test_[A-Za-z0-9]{12,}$/u.test(secret || '')) {
    fail('STRIPE_TEST_SECRET_REQUIRED');
  }
  const url = new URL('/v1/prices', 'https://api.stripe.com');
  url.searchParams.set('active', 'true');
  url.searchParams.set('limit', '20');
  url.searchParams.append('lookup_keys[]', PLANS[0].lookup);
  url.searchParams.append('lookup_keys[]', PLANS[1].lookup);
  url.searchParams.append('expand[]', 'data.product');
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + secret },
    redirect: 'error',
    signal: AbortSignal.timeout(20_000)
  });
  requireSafeResponse(response);
  const data = await response.json();
  if (data?.object !== 'list' || data?.has_more !== false) {
    fail('STRIPE_TEST_PRICES_INCOMPLETE');
  }
  return validatePricePair(data.data);
}

export async function verifyStagingAdminKey(secret, fetchImpl) {
  if (
    typeof secret !== 'string' ||
    !(
      /^sb_secret_[A-Za-z0-9_]{8,}$/u.test(secret) ||
      /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(secret)
    )
  ) {
    fail('STAGING_SERVER_SECRET_REQUIRED');
  }
  // The endpoint is read-only. Never inspect the response body (may contain PII).
  const url = STAGING_URL + '/auth/v1/admin/users?page=1&per_page=1';
  const response = await fetchImpl(url, {
    method: 'GET',
    // Modern opaque secrets belong in apikey, never a JWT Bearer header.
    // Legacy service_role JWTs still require Authorization for Auth admin.
    headers: secret.startsWith('sb_secret_')
      ? { apikey: secret }
      : { apikey: secret, Authorization: 'Bearer ' + secret },
    redirect: 'error',
    signal: AbortSignal.timeout(20_000)
  });
  requireSafeResponse(response);
  return true;
}

async function vercelGet(fetchImpl, path, token, branch) {
  const url = new URL(path, 'https://api.vercel.com');
  url.searchParams.set('teamId', TEAM_ID);
  url.searchParams.set('gitBranch', branch);
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token },
    redirect: 'error',
    signal: AbortSignal.timeout(20_000)
  });
  requireSafeResponse(response);
  return noPagination(await response.json());
}

export async function provisionAccountDeletionEnv({
  env,
  fetchImpl = globalThis.fetch,
  resolveScope = resolveVercelProjectScope,
  verifySupabase = verifyStagingAdminKey,
  verifyStripe = retrieveStripeTestPrices,
  reportStage = () => {}
}) {
  reportStage('CONTEXT');
  const freeOnly = env.STAGING_DELETE_FREE_MODE === 'true';
  if (
    (env.STAGING_DELETE_FREE_MODE &&
      !['true', 'false'].includes(env.STAGING_DELETE_FREE_MODE)) ||
    (freeOnly &&
      env.STAGING_FREE_APPROVAL_SCOPE !==
        'account-deletion-free-env-provision')
  ) {
    fail('RUN_CONTEXT_MISMATCH');
  }
  if (
    env.GITHUB_REPOSITORY !== REPO ||
    env.STAGING_PREVIEW_REF !== FIX_BRANCH ||
    env.STAGING_SUPABASE_URL !== STAGING_URL ||
    env.APPROVED_MAIN_SHA !== env.CHECKED_OUT_MAIN_SHA ||
    !SHA.test(env.APPROVED_MAIN_SHA || '') ||
    !SHA.test(env.EXPECTED_FIX_SHA || '') ||
    env.APPROVED_MAIN_SHA === env.EXPECTED_FIX_SHA
  ) {
    fail('RUN_CONTEXT_MISMATCH');
  }
  if (
    typeof env.VERCEL_API_TOKEN !== 'string' ||
    env.VERCEL_API_TOKEN.length < 12
  ) {
    fail('VERCEL_CREDENTIAL_REQUIRED');
  }

  reportStage('VERCEL_SCOPE');
  const scope = await resolveScope({
    fetchImpl,
    token: env.VERCEL_API_TOKEN,
    project: PROJECT
  });
  if (scope.teamId !== TEAM_ID || scope.projectId !== PROJECT_ID) {
    fail('VERCEL_TARGET_MISMATCH');
  }
  const path = '/v10/projects/' + encodeURIComponent(PROJECT_ID) + '/env';
  reportStage('VERCEL_INVENTORY');
  const inventory = await vercelGet(
    fetchImpl,
    path,
    env.VERCEL_API_TOKEN,
    FIX_BRANCH
  );
  assertProvisioningInventory(
    inventory,
    'before',
    freeOnly ? 'free' : 'standard'
  );

  // No mutation unless BOTH independent service credentials and Stripe
  // TEST prices are verified. API responses are not logged or persisted.
  reportStage('SUPABASE_ADMIN');
  if (
    (await verifySupabase(env.STAGING_SUPABASE_SECRET_KEY, fetchImpl)) !== true
  ) {
    fail('STAGING_SECRET_NOT_VERIFIED');
  }
  let verified = null;
  if (freeOnly) {
    // The free-only scope never calls Stripe or requires any Price objects.
    // Runtime proof separately rejects live-mode Stripe keys.
    if (!/^sk_test_[A-Za-z0-9]{12,}$/u.test(env.STRIPE_TEST_SECRET_KEY || '')) {
      fail('STRIPE_TEST_SECRET_REQUIRED');
    }
    reportStage('STRIPE_TEST_KEY_CLASS');
  } else {
    reportStage('STRIPE_TEST_PRICES');
    verified = await verifyStripe(env.STRIPE_TEST_SECRET_KEY, fetchImpl);
    if (
      !PRICE_ID.test(verified?.standardPriceId || '') ||
      !PRICE_ID.test(verified?.premiumPriceId || '') ||
      verified.standardPriceId === verified.premiumPriceId
    ) {
      fail('STRIPE_TEST_PRICES_NOT_VERIFIED');
    }
  }

  const requestBody = [
    {
      key: 'SUPABASE_SECRET_KEY',
      value: env.STAGING_SUPABASE_SECRET_KEY,
      type: 'sensitive'
    },
    {
      key: 'STRIPE_SECRET_KEY',
      value: env.STRIPE_TEST_SECRET_KEY,
      type: 'sensitive'
    },
    ...(freeOnly
      ? []
      : [
          {
            key: 'STRIPE_STANDARD_PRICE_ID',
            value: verified.standardPriceId,
            type: 'sensitive'
          },
          {
            key: 'STRIPE_PREMIUM_PRICE_ID',
            value: verified.premiumPriceId,
            type: 'sensitive'
          }
        ])
  ].map((item) => ({
    ...item,
    target: ['preview'],
    gitBranch: FIX_BRANCH,
    comment:
      'Account deletion #82: approved one-use protected Staging provisioning only'
  }));

  const url = new URL(path, 'https://api.vercel.com');
  url.searchParams.set('teamId', TEAM_ID);
  reportStage('VERCEL_PREVIEW_WRITE');
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + env.VERCEL_API_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody),
    redirect: 'error',
    signal: AbortSignal.timeout(20_000)
  });
  requireSafeResponse(response);

  reportStage('POST_WRITE_VERIFY');
  const postInventory = await vercelGet(
    fetchImpl,
    path,
    env.VERCEL_API_TOKEN,
    FIX_BRANCH
  );
  assertProvisioningInventory(
    postInventory,
    'after',
    freeOnly ? 'free' : 'standard'
  );
  reportStage('COMPLETE');
  return Object.freeze({
    branch: FIX_BRANCH,
    createdKeys: freeOnly ? [...FREE_MISSING] : [...MISSING],
    verifiedPriceCount: freeOnly ? 0 : 2,
    environment: 'preview'
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  provisionAccountDeletionEnv({
    env: process.env,
    // Only fixed stage names are emitted; never print a secret or API error body.
    reportStage: (stage) => console.log('ACCOUNT_ENV_STAGE_' + stage)
  })
    .then((result) => {
      console.log(
        result.verifiedPriceCount === 0
          ? 'ACCOUNT_ENV_PROVISION_OK: two branch-only TEST credentials; no prices, Stripe API request or Preview deployment.'
          : 'ACCOUNT_ENV_PROVISION_OK: four branch-only values; two validated TEST prices; no Preview deployment.'
      );
      if (process.env.GITHUB_STEP_SUMMARY) {
        // No secrets, prices or URLs appear in step summary.
        import('node:fs/promises')
          .then(({ appendFile }) =>
            appendFile(
              process.env.GITHUB_STEP_SUMMARY,
              'Account #82 Staging-only environment: ' +
                (result.verifiedPriceCount === 0 ? '6 of 6' : '8 of 8') +
                ' required key classes configured. Preview and authenticated deletion E2E not run.\n'
            )
          )
          .catch(() => {
            process.exitCode = 1;
          });
      }
      return result;
    })
    .catch(() => {
      // NEVER print error.message, API bodies or secrets in logs.
      console.error(
        'ACCOUNT_ENV_PROVISION_DENIED: safe verification or provisioning failed.'
      );
      process.exitCode = 1;
    });
}
