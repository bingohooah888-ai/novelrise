import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolveVercelProjectScope } from './vercel-admin-allowlist.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const BRANCH = 'fix/inquiry-82-account-deletion-diagnostics-20261107';
const PROJECT_ID = 'prj_SmotUNrcyuUntdWTayzWeJ8eQGqe';
const TEAM_ID = 'team_2XFgtRCPJQ6pbrEa4mOLQAEx';
const STAGING = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
const PROD = 'https://fiepaguycecrredwrcwx.supabase.co';
const SIX = Object.freeze([
  'SUPABASE_URL',
  'NOVELIGHT_STAGING_SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'STRIPE_SECRET_KEY'
]);
const SHA = /^[a-f0-9]{40}$/u;

function deny() {
  throw new Error('PREMIUM_STAGING_TARGET_DENIED');
}

export function checkPremiumTargetContext(env) {
  if (
    env.GITHUB_REPOSITORY !== REPO ||
    env.STAGING_TRIGGER !== 'approval_comment' ||
    env.STAGING_PREMIUM_APPROVED !== 'true' ||
    env.STAGING_PREMIUM_SCOPE !== 'account-deletion-premium-staging-e2e-once' ||
    env.GITHUB_RUN_ATTEMPT !== '1' ||
    env.STAGING_PREVIEW_REF !== BRANCH ||
    env.STAGING_EXPECTED_SUPABASE_URL !== STAGING ||
    env.STAGING_EXPECTED_SUPABASE_URL === PROD ||
    env.STAGING_E2E_READY !== 'true' ||
    !SHA.test(env.APPROVED_MAIN_SHA || '') ||
    !SHA.test(env.EXPECTED_REVISION || '') ||
    env.APPROVED_MAIN_SHA === env.EXPECTED_REVISION ||
    !env.STAGING_SUPABASE_PUBLISHABLE_KEY ||
    !env.STAGING_SUPABASE_SECRET_KEY ||
    !/^sk_test_[A-Za-z0-9_]{12,}$/u.test(env.STRIPE_TEST_SECRET_KEY || '') ||
    !/^[0-9a-f]{64}$/u.test(env.STRIPE_TEST_EXPECTED_ACCOUNT_SHA256 || '') ||
    !env.VERCEL_API_TOKEN ||
    !env.VERCEL_AUTOMATION_BYPASS_SECRET
  )
    deny();
  return true;
}

function exactKeys(envs) {
  if (!Array.isArray(envs) || envs.length !== SIX.length) deny();
  const byName = new Map();
  for (const item of envs) {
    if (
      !SIX.includes(item?.key) ||
      byName.has(item.key) ||
      item.gitBranch !== BRANCH ||
      !Array.isArray(item.target) ||
      item.target.length !== 1 ||
      item.target[0] !== 'preview'
    )
      deny();
    byName.set(item.key, item);
  }
  if (byName.size !== SIX.length) deny();
  return byName;
}

export function validatePremiumPreviewInventory(envs, env) {
  checkPremiumTargetContext(env);
  const values = exactKeys(envs);
  for (const key of SIX.slice(0, 2)) {
    const row = values.get(key);
    if (row.type !== 'plain' || row.value !== STAGING) deny();
  }
  for (const key of SIX.slice(2)) {
    const row = values.get(key);
    if (!['sensitive', 'encrypted'].includes(row.type)) deny();
    // Saved Vercel Secrets cannot be read back. Verify metadata here,
    // then check the actual Preview TEST account in a non-mutating API proof.
  }
  return Object.freeze({
    branch: BRANCH,
    keyCount: SIX.length,
    isolated: true
  });
}

export function validatePremiumPreviewFacts(facts, env) {
  checkPremiumTargetContext(env);
  const origin = env.CANONICAL_STAGING_URL || '';
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    deny();
  }
  if (
    parsed.origin !== origin ||
    parsed.protocol !== 'https:' ||
    parsed.hostname === 'novelrise.vercel.app' ||
    !parsed.hostname.endsWith('.vercel.app') ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    facts?.vercelEnv !== 'preview' ||
    facts?.commitSha !== env.EXPECTED_REVISION ||
    facts?.appBaseUrl !== origin ||
    facts?.supabase?.url !== STAGING ||
    facts?.supabase?.serverSecretPresent !== true ||
    !['publishable', 'legacy-anon'].includes(
      facts?.supabase?.publishableKeyClass
    ) ||
    facts?.supabase?.publishableKeyFingerprint !==
      createHash('sha256')
        .update(env.STAGING_SUPABASE_PUBLISHABLE_KEY)
        .digest('hex') ||
    facts?.stripe?.secretKeyMode !== 'test' ||
    facts?.stripe?.standardPricePresent === true ||
    facts?.stripe?.premiumPricePresent === true
  )
    deny();
  return Object.freeze({ verified: true, staging: STAGING, origin });
}

async function getJson(url, headers, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(20000)
    });
  } catch {
    deny();
  }
  if (!response?.ok) deny();
  try {
    return await response.json();
  } catch {
    deny();
  }
}

export async function preflightPremiumTarget({
  env = process.env,
  fetchImpl = globalThis.fetch,
  resolveScope = resolveVercelProjectScope
} = {}) {
  checkPremiumTargetContext(env);
  const scope = await resolveScope({
    token: env.VERCEL_API_TOKEN,
    project: 'novelrise',
    fetchImpl
  });
  if (scope.projectId !== PROJECT_ID || scope.teamId !== TEAM_ID) deny();

  const url = new URL(
    '/v10/projects/' + encodeURIComponent(PROJECT_ID) + '/env',
    'https://api.vercel.com'
  );
  url.searchParams.set('teamId', TEAM_ID);
  url.searchParams.set('gitBranch', BRANCH);
  url.searchParams.set('decrypt', 'false');
  const payload = await getJson(
    url,
    {
      Authorization: 'Bearer ' + env.VERCEL_API_TOKEN
    },
    fetchImpl
  );
  if (payload?.pagination?.next != null) deny();
  return validatePremiumPreviewInventory(payload?.envs, env);
}

export async function verifyPremiumPreview({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  checkPremiumTargetContext(env);
  const origin = env.CANONICAL_STAGING_URL || '';
  let url;
  try {
    url = new URL(origin + '/api/staging-environment-facts');
  } catch {
    deny();
  }
  if (
    url.origin !== origin ||
    url.pathname !== '/api/staging-environment-facts'
  )
    deny();
  const facts = await getJson(
    url,
    {
      Accept: 'application/json',
      'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET
    },
    fetchImpl
  );
  const verified = validatePremiumPreviewFacts(facts, env);
  // Vercel Secrets can be write-only. Attest the actual deployed TEST account
  // inside Preview instead of attempting to decrypt or export its secret.
  const identity = await getJson(
    new URL(origin + '/api/staging-premium-account-proof'),
    {
      Accept: 'application/json',
      'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET,
      'x-novelight-expected-account-sha256':
        env.STRIPE_TEST_EXPECTED_ACCOUNT_SHA256
    },
    fetchImpl
  );
  if (
    !identity ||
    Object.keys(identity).length !== 1 ||
    identity.accountMatch !== true
  )
    deny();
  return verified;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const task = process.argv[2];
  const action =
    task === '--preflight'
      ? preflightPremiumTarget
      : task === '--verify-preview'
        ? verifyPremiumPreview
        : null;
  if (!action || process.argv.length !== 3) {
    console.error('PREMIUM_STAGING_TARGET_DENIED');
    process.exitCode = 1;
  } else {
    action()
      .then(() => console.log('PREMIUM_STAGING_TARGET_VERIFIED'))
      .catch(() => {
        // No decrypted settings or API payloads are ever logged.
        console.error('PREMIUM_STAGING_TARGET_DENIED');
        process.exitCode = 1;
      });
  }
}
