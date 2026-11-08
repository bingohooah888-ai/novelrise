import { pathToFileURL } from 'node:url';
import { resolveVercelProjectScope } from './vercel-admin-allowlist.mjs';

const PREVIEW_BRANCH = 'fix/inquiry-82-account-deletion-diagnostics-20261107';
const STAGING_URL = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
const PROD_URL = 'https://fiepaguycecrredwrcwx.supabase.co';

const FREE_BRANCH_VARIABLES = Object.freeze([
  'SUPABASE_URL',
  'NOVELIGHT_STAGING_SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'STRIPE_SECRET_KEY'
]);

const REQUIRED_BRANCH_VARIABLES = Object.freeze([
  'SUPABASE_URL',
  'NOVELIGHT_STAGING_SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_STANDARD_PRICE_ID',
  'STRIPE_PREMIUM_PRICE_ID'
]);

function deny() {
  throw new Error(
    'ACCOUNT_PREVIEW_ENV_DENIED: branch-specific isolated Staging configuration is incomplete.'
  );
}

// A pre-cost gate; only inspects metadata and public-class URL fields.
// Do not return/log any Vercel secrets, keys, or price identifiers.
export function assertAccountPreviewEnvironment({
  envs,
  branch,
  expectedUrl,
  mode = 'standard'
}) {
  const required =
    mode === 'free'
      ? FREE_BRANCH_VARIABLES
      : mode === 'standard'
        ? REQUIRED_BRANCH_VARIABLES
        : null;
  if (
    branch !== PREVIEW_BRANCH ||
    expectedUrl !== STAGING_URL ||
    expectedUrl === PROD_URL ||
    !required ||
    !Array.isArray(envs)
  ) {
    deny();
  }
  const variables = new Map();
  for (const item of envs) {
    if (
      !item ||
      item.gitBranch !== branch ||
      !Array.isArray(item.target) ||
      !item.target.includes('preview')
    )
      continue;
    if (!required.includes(item.key)) continue;
    if (variables.has(item.key)) deny();
    variables.set(item.key, item);
  }
  for (const name of required) {
    if (!variables.has(name)) deny();
  }
  for (const name of ['SUPABASE_URL', 'NOVELIGHT_STAGING_SUPABASE_URL']) {
    const item = variables.get(name);
    if (item.type !== 'plain' || item.value !== expectedUrl) deny();
  }
  for (const name of [
    'SUPABASE_PUBLISHABLE_KEY',
    'NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SECRET_KEY',
    'STRIPE_SECRET_KEY'
  ]) {
    if (!['sensitive', 'encrypted'].includes(variables.get(name).type)) deny();
  }
  return {
    ready: true,
    requiredVariableCount: required.length,
    branchScoped: true,
    // Runtime Vercel facts must separately prove Stripe TEST and Staging.
    runtimeClassProofPending: true
  };
}

export async function checkAccountPreviewEnvironment({
  env = process.env,
  fetchImpl = globalThis.fetch,
  resolveScope = resolveVercelProjectScope
} = {}) {
  const branch = env.STAGING_PREVIEW_REF;
  const expectedUrl = env.STAGING_EXPECTED_SUPABASE_URL;
  const freeMode = env.STAGING_DELETE_FREE_MODE === 'true';
  const mode = freeMode ? 'free' : 'standard';
  if (
    (env.STAGING_DELETE_FREE_MODE &&
      !['true', 'false'].includes(env.STAGING_DELETE_FREE_MODE)) ||
    (freeMode &&
      (env.STAGING_TRIGGER !== 'approval_comment' ||
        env.GITHUB_REPOSITORY !== 'bingohooah888-ai/novelrise' ||
        ![
          'account-deletion-free-preview',
          'account-deletion-free-proof'
        ].includes(env.STAGING_FREE_APPROVAL_SCOPE)))
  ) {
    deny();
  }
  if (
    branch !== PREVIEW_BRANCH ||
    expectedUrl !== STAGING_URL ||
    env.STAGING_E2E_READY !== 'true' ||
    !env.STAGING_EXPECTED_PUBLISHABLE_KEY ||
    !env.VERCEL_AUTOMATION_BYPASS_SECRET
  ) {
    deny();
  }
  const token = env.VERCEL_API_TOKEN;
  if (!token) deny();
  const scope = await resolveScope({
    token,
    project: 'novelrise',
    fetchImpl
  });
  const url = new URL(
    '/v10/projects/' + encodeURIComponent(scope.projectId) + '/env',
    'https://api.vercel.com'
  );
  url.searchParams.set('teamId', scope.teamId);
  url.searchParams.set('gitBranch', branch);
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token },
    redirect: 'error',
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) deny();
  const payload = await response.json();
  if (payload.pagination?.next != null) deny();
  return assertAccountPreviewEnvironment({
    envs: payload.envs,
    branch,
    expectedUrl,
    mode
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  checkAccountPreviewEnvironment()
    .then((result) => {
      console.log(
        'Reviewed candidate Preview environment preflight passed: ' +
          result.requiredVariableCount +
          ' branch-only variable classes.'
      );
    })
    .catch((error) => {
      // Do not stringify the external API response or credential-bearing errors.
      console.error(
        error.message.startsWith('ACCOUNT_PREVIEW_ENV_DENIED')
          ? error.message
          : 'ACCOUNT_PREVIEW_ENV_DENIED: network or metadata verification failed.'
      );
      process.exitCode = 1;
    });
}
