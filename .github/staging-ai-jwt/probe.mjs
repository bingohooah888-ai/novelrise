// TRUSTED-MAIN COPY. Runs only via OWNER-gated one-time JWT Staging workflow.
// No test-account provisioning, no DB/AI writes and no deployment occur here.
// Sign-in changes auth.last_sign_in_at: separately approved Staging JWT scope
// and a dedicated pre-provisioned synthetic Auth user are REQUIRED to run.
import { pathToFileURL } from 'node:url';

import { createClient } from '@supabase/supabase-js';

const SHA = /^[a-f0-9]{40}$/u;
const STAGING = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
const TEST_ID = '00000000-0000-4000-8000-000000000943';
const TEST_EMAIL = 'ai-review-jwt@example.invalid';
const TEST_NOVEL = 998891003;
const VERCEL_PROJECT = 'prj_SmotUNrcyuUntdWTayzWeJ8eQGqe';
const VERCEL_TEAM = 'team_2XFgtRCPJQ6pbrEa4mOLQAEx';
const PREVIEW_HOST = /^novelrise-[a-z0-9-]+-ranobe1\.vercel\.app$/u;
const DEPLOYMENT_ID = /^dpl_[a-zA-Z0-9]+$/u;
const CANDIDATE_BRANCH = 'codex/ai020704-staging-candidate-db-20261028';

function deny(message) {
  throw new Error('AI_HOSTED_JWT_PROOF_DENIED: ' + message);
}

export function validateHostedJwtProofConfig(env) {
  if (env.NOVELIGHT_HOSTED_JWT_ADMITTED !== '1' ||
      env.STAGING_PROJECT_REF !== 'wmlzjgvxgoyrovdhbqbg' ||
      env.NOVELIGHT_HOSTED_TEST_USER_ID !== TEST_ID ||
      env.NOVELIGHT_HOSTED_TEST_USER_EMAIL !== TEST_EMAIL ||
      env.NOVELIGHT_HOSTED_TEST_NOVEL_ID !== String(TEST_NOVEL) ||
      !SHA.test(env.APPROVED_MAIN_SHA || '') ||
      !SHA.test(env.APPROVED_CANDIDATE_SHA || '') ||
      !SHA.test(env.APPROVED_PREVIEW_SHA || '') ||
      env.APPROVED_PREVIEW_SHA !== env.APPROVED_CANDIDATE_SHA ||
      !/^[1-9][0-9]*$/u.test(env.STAGING_APPROVAL_COMMENT_ID || '') ||
      typeof env.NOVELIGHT_HOSTED_TEST_USER_PASSWORD !== 'string' ||
      env.NOVELIGHT_HOSTED_TEST_USER_PASSWORD.length < 12 ||
      typeof env.VERCEL_AUTOMATION_BYPASS_SECRET !== 'string' ||
      !env.VERCEL_AUTOMATION_BYPASS_SECRET ||
      !DEPLOYMENT_ID.test(env.NOVELIGHT_HOSTED_PREVIEW_DEPLOYMENT_ID || '') ||
      typeof env.VERCEL_READONLY_API_TOKEN !== 'string' ||
      env.VERCEL_READONLY_API_TOKEN.length < 20) {
    deny('missing dedicated admission, synthetic user, or immutable pins');
  }
  let preview;
  try {
    preview = new URL(env.NOVELIGHT_HOSTED_PREVIEW_URL);
  } catch {
    deny('invalid Preview URL');
  }
  if (preview.protocol !== 'https:' || preview.username || preview.password ||
      preview.port || preview.pathname !== '/' ||
      preview.search || preview.hash ||
      !PREVIEW_HOST.test(preview.hostname)) {
    deny('Preview must be an isolated exact HTTPS Vercel origin');
  }
  return Object.freeze({
    preview: preview.origin,
    stage: STAGING,
    revision: env.APPROVED_PREVIEW_SHA,
    userId: TEST_ID,
    email: TEST_EMAIL,
    novelId: TEST_NOVEL,
    deploymentId: env.NOVELIGHT_HOSTED_PREVIEW_DEPLOYMENT_ID
  });
}

// This is an independently queried Vercel deployment, NOT information
// self-reported by the Preview server that will later receive the JWT.
export function assertVerifiedVercelPreview(config, deployment) {
  if (
    !deployment ||
    deployment.id !== config.deploymentId ||
    (deployment.project?.id ?? deployment.projectId) !== VERCEL_PROJECT ||
    deployment.name !== 'novelrise' ||
    deployment.url !== new URL(config.preview).hostname ||
    deployment.readyState !== 'READY' ||
    (deployment.target !== null && deployment.target !== 'preview') ||
    deployment.meta?.githubOrg !== 'bingohooah888-ai' ||
    deployment.meta?.githubRepo !== 'novelrise' ||
    deployment.meta?.githubCommitRef !== CANDIDATE_BRANCH ||
    deployment.meta?.githubCommitSha !== config.revision
  ) {
    deny('Vercel project, Preview origin, or exact deployment revision mismatch');
  }
  return true;
}

// Metadata-only check; never request decrypted secrets. This proves that
// branch-specific settings predate the immutable deployment, NOT that an
// unreadable server secret actually belongs to Supabase Staging.
const FROZEN_PREVIEW_KEYS = Object.freeze([
  'SUPABASE_URL',
  'NOVELIGHT_STAGING_SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'NOVELIGHT_AI_ADMIN_USER_ID',
  'NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED',
  'NOVELIGHT_AI_REVIEW_ENABLED',
  'STRIPE_SECRET_KEY',
  'STRIPE_STANDARD_PRICE_ID',
  'STRIPE_PREMIUM_PRICE_ID',
  'STRIPE_WEBHOOK_SECRET'
]);

export function assertFrozenPreviewEnvMetadata(deployment, payload) {
  const vars = payload?.envs;
  if (!Number.isSafeInteger(deployment?.createdAt) ||
      !Array.isArray(vars) || vars.length !== FROZEN_PREVIEW_KEYS.length) {
    deny('Preview environment inventory is not complete');
  }
  const seen = new Set();
  for (const entry of vars) {
    if (!entry || !FROZEN_PREVIEW_KEYS.includes(entry.key) ||
        seen.has(entry.key) ||
        entry.gitBranch !== CANDIDATE_BRANCH ||
        !Array.isArray(entry.target) || entry.target.length !== 1 ||
        entry.target[0] !== 'preview' ||
        !Number.isSafeInteger(entry.createdAt) ||
        !Number.isSafeInteger(entry.updatedAt) ||
        entry.createdAt > entry.updatedAt ||
        entry.updatedAt > deployment.createdAt) {
      deny('Preview branch environment changed after pinned deployment');
    }
    seen.add(entry.key);
    const type = entry.key.includes('SECRET_KEY') ||
      entry.key.includes('PUBLISHABLE_KEY') ||
      entry.key === 'STRIPE_WEBHOOK_SECRET';
    if (type && entry.type !== 'sensitive') {
      deny('Preview sensitive keys have unsafe type');
    }
    if ((entry.key === 'SUPABASE_URL' ||
         entry.key === 'NOVELIGHT_STAGING_SUPABASE_URL') &&
        (entry.type !== 'plain' || entry.value !== STAGING)) {
      deny('Preview Supabase URL not pinned to staging');
    }
    if ((entry.key === 'NOVELIGHT_AI_REVIEW_ENABLED' ||
         entry.key === 'NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED') &&
        (entry.type !== 'plain' || entry.value !== 'true')) {
      deny('Preview AI probe flags do not match reviewed build');
    }
  }
  if (seen.size !== FROZEN_PREVIEW_KEYS.length) {
    deny('Preview environment inventory contains a missing key');
  }
  return true;
}

export async function verifyHostedPreviewViaVercel(
  config,
  env,
  fetcher = globalThis.fetch
) {
  const url =
    'https://api.vercel.com/v13/deployments/' +
    config.deploymentId +
    '?teamId=' +
    VERCEL_TEAM;
  const response = await fetcher(url, {
    headers: {
      authorization: 'Bearer ' + env.VERCEL_READONLY_API_TOKEN,
      'cache-control': 'no-store'
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(12000)
  });
  if (response.status !== 200) {
    deny('could not verify Vercel deployment metadata');
  }
  const deployed = await response.json();
  assertVerifiedVercelPreview(config, deployed);
  // Protection is project-level and can change without rebuilding the pinned
  // deployment. Recheck the independently authenticated Vercel project API
  // immediately before any synthetic Auth identity can be created.
  const projectResponse = await fetcher(
    'https://api.vercel.com/v1/projects/' +
      VERCEL_PROJECT +
      '?teamId=' +
      VERCEL_TEAM,
    {
      headers: {
        authorization: 'Bearer ' + env.VERCEL_READONLY_API_TOKEN,
        'cache-control': 'no-store'
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(12000)
    }
  );
  if (projectResponse.status !== 200) {
    deny('could not verify Vercel Preview protection');
  }
  const project = await projectResponse.json();
  if (
    project?.id !== VERCEL_PROJECT ||
    project.name !== 'novelrise' ||
    project.ssoProtection?.enabled !== true ||
    project.ssoProtection?.deploymentType !== 'all_except_custom_domains'
  ) {
    deny('pinned Preview is not protected by Vercel Authentication');
  }
  const inventory = await fetcher(
    'https://api.vercel.com/v10/projects/' +
      VERCEL_PROJECT +
      '/env?teamId=' + VERCEL_TEAM +
      '&gitBranch=' + encodeURIComponent(CANDIDATE_BRANCH) +
      '&decrypt=false',
    {
      headers: {
        authorization: 'Bearer ' + env.VERCEL_READONLY_API_TOKEN,
        'cache-control': 'no-store'
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(12000)
    }
  );
  if (inventory.status !== 200) {
    deny('could not independently verify Preview env metadata');
  }
  assertFrozenPreviewEnvMetadata(deployed, await inventory.json());
}

async function getJson(url, headers, allowedStatus = 200) {
  const response = await globalThis.fetch(url, {
    headers: { ...headers, 'cache-control': 'no-store' },
    redirect: 'manual',
    signal: AbortSignal.timeout(12000)
  });
  if (response.status !== allowedStatus) {
    deny('unexpected protected response status');
  }
  return response.json();
}

export async function probeRealHostedJwt(config, env, revokeToken) {
  // Revocation is mandatory and must be supplied by the trusted server-side
  // Staging Admin client. No sign-in may happen if cleanup is unavailable.
  if (typeof revokeToken !== 'function') {
    deny('missing mandatory trusted Auth session revocation callback');
  }
  // No Preview request, protection bypass or Auth login before Vercel's own
  // API attests this exact READY, non-Production deployment and Git SHA.
  await verifyHostedPreviewViaVercel(config, env);
  const protection = {
    'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET
  };
  const facts = await getJson(
    config.preview + '/api/staging-environment-facts',
    protection
  );
  if (facts.vercelEnv !== 'preview' ||
      facts.commitSha !== config.revision ||
      facts.appBaseUrl !== config.preview ||
      facts.supabase?.url !== config.stage ||
      facts.supabase?.serverSecretPresent !== true ||
      facts.stripe?.secretKeyMode !== 'test') {
    deny('Preview is not pinned to isolated Staging');
  }
  const browser = await getJson(
    config.preview + '/api/staging-browser-config',
    protection
  );
  if (browser.supabaseUrl !== config.stage ||
      !/^sb_publishable_[a-zA-Z0-9_-]+$/u.test(
        browser.supabasePublishableKey || ''
      )) {
    deny('browser Supabase configuration unsafe');
  }

  const supabase = createClient(
    config.stage,
    browser.supabasePublishableKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  // First external mutation: Auth sign-in updates last_sign_in_at.
  // ONLY an already approved isolated user may reach this point.
  const signedIn = await supabase.auth.signInWithPassword({
    email: config.email,
    password: env.NOVELIGHT_HOSTED_TEST_USER_PASSWORD
  });
  const token = signedIn.data?.session?.access_token;
  if (typeof token !== 'string' || !token) {
    deny('isolated test user sign-in returned no revocable bearer');
  }
  let passed = false;
  try {
    if (signedIn.error || signedIn.data?.user?.id !== config.userId) {
      deny('isolated test user sign-in failed identity verification');
    }
    const verified = await supabase.auth.getUser(token);
    if (verified.error || verified.data?.user?.id !== config.userId) {
      deny('Supabase Auth did not verify owner bearer');
    }

    const path = '/api/ai-owner-bible-review?novel_id=' + config.novelId;
    const unauthorized = await globalThis.fetch(config.preview + path, {
      headers: protection,
      redirect: 'manual',
      signal: AbortSignal.timeout(12000)
    });
    if (unauthorized.status !== 401) {
      deny('missing bearer was not rejected');
    }
    const ownerProof = await getJson(config.preview + path, {
      ...protection,
      Authorization: 'Bearer ' + token
    });
    if (ownerProof?.novelId !== config.novelId ||
        !Array.isArray(ownerProof?.candidates) ||
        ownerProof.aiGenerated !== false) {
      deny('hosted owner review GET did not return synthetic owner data');
    }
    passed = true;
  } finally {
    // Executed after every obtained bearer, even if the HTTP or identity
    // assertion fails. Auth JWT access tokens themselves remain valid until
    // expiry; this revokes refresh/session state, not the JWT cryptography.
    try {
      await revokeToken(token);
    } catch {
      deny('dedicated Staging Auth session revocation failed');
    }
  }
  if (!passed) deny('owner proof did not pass');
  // No bearer, secret, email/password, or manuscript may enter logs.
  return Object.freeze({ passed: true, revision: config.revision });
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const cfg = validateHostedJwtProofConfig(process.env);
    // Standalone probe has no trusted Auth Admin revoker: deliberately denied.
    await probeRealHostedJwt(cfg, process.env);
    process.stdout.write('AI_HOSTED_REAL_JWT_GET_PASS\n');
  } catch {
    console.error('AI_HOSTED_REAL_JWT_PROOF_DENIED');
    process.exitCode = 1;
  }
}
