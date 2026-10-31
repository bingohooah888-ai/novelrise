// 02-07-04: hard-pinned, read-only trust check BEFORE any Staging fixture.
// This code never authorizes AI spending, deployment creation, or a public URL.
const SHA = /^[a-f0-9]{40}$/u;
const STAGING = 'https://wmlzjgvxgoyrovdhbqbg.supabase.co';
const PRODUCTION = 'https://fiepaguycecrredwrcwx.supabase.co';
const BRANCH = 'staging/ai-02-07-04-owner-ui-proof-20261101';
const PROJECT = 'prj_SmotUNrcyuUntdWTayzWeJ8eQGqe';
const TEAM = 'team_2XFgtRCPJQ6pbrEa4mOLQAEx';
const HOST = /^novelrise-[a-z0-9-]+-ranobe1\.vercel\.app$/u;

function denied() {
  throw new Error('AI_020704_HOSTED_BROWSER_PROOF_DENIED');
}

export function validateHostedBrowserProof(env) {
  if (
    env.NOVELIGHT_AI_020704_HOSTED_BROWSER_ADMITTED !== '1' ||
    env.STAGING_PROJECT_REF !== 'wmlzjgvxgoyrovdhbqbg' ||
    env.STAGING_SUPABASE_URL !== STAGING ||
    !SHA.test(env.APPROVED_MAIN_SHA || '') ||
    env.APPROVED_PREVIEW_SHA !== env.APPROVED_MAIN_SHA ||
    !/^[1-9]\d*$/u.test(env.STAGING_APPROVAL_COMMENT_ID || '') ||
    !/^dpl_[a-zA-Z0-9]+$/u.test(env.NOVELIGHT_HOSTED_PREVIEW_DEPLOYMENT_ID || '') ||
    typeof env.VERCEL_READONLY_API_TOKEN !== 'string' ||
    env.VERCEL_READONLY_API_TOKEN.length < 20 ||
    typeof env.VERCEL_AUTOMATION_BYPASS_SECRET !== 'string' ||
    env.VERCEL_AUTOMATION_BYPASS_SECRET.length < 16
  ) denied();

  let origin;
  try {
    origin = new URL(env.NOVELIGHT_HOSTED_PREVIEW_URL);
  } catch {
    denied();
  }
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.port ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    !HOST.test(origin.hostname)
  ) denied();
  return Object.freeze({
    origin: origin.origin,
    host: origin.hostname,
    sha: env.APPROVED_MAIN_SHA,
    deploymentId: env.NOVELIGHT_HOSTED_PREVIEW_DEPLOYMENT_ID,
    staging: STAGING,
    branch: BRANCH
  });
}

async function get(response, label) {
  if (response.status !== 200) denied();
  const data = await response.json();
  if (!data || typeof data !== 'object') denied();
  return data;
}

function boundedFetch(fetcher, url, headers) {
  return fetcher(url, {
    headers: { ...headers, 'cache-control': 'no-store' },
    redirect: 'manual',
    signal: AbortSignal.timeout(12000)
  });
}

export async function checkHostedBrowserPreview(
  config,
  env,
  fetcher = globalThis.fetch
) {
  const v = { Authorization: 'Bearer ' + env.VERCEL_READONLY_API_TOKEN };
  const meta = await get(
    await boundedFetch(
      fetcher,
      'https://api.vercel.com/v13/deployments/' +
        config.deploymentId + '?teamId=' + TEAM,
      v
    ),
    'deployment'
  );
  if (
    meta.id !== config.deploymentId ||
    (meta.project?.id ?? meta.projectId) !== PROJECT ||
    meta.name !== 'novelrise' ||
    meta.url !== config.host ||
    meta.readyState !== 'READY' ||
    (meta.target !== null && meta.target !== 'preview') ||
    meta.meta?.githubOrg !== 'bingohooah888-ai' ||
    meta.meta?.githubRepo !== 'novelrise' ||
    meta.meta?.githubCommitRef !== BRANCH ||
    meta.meta?.githubCommitSha !== config.sha
  ) denied();

  const project = await get(
    await boundedFetch(
      fetcher,
      'https://api.vercel.com/v1/projects/' + PROJECT + '?teamId=' + TEAM,
      v
    ),
    'project'
  );
  if (
    project.id !== PROJECT ||
    project.name !== 'novelrise' ||
    !project.ssoProtection ||
    project.ssoProtection.enabled === false ||
    project.ssoProtection.deploymentType !== 'all_except_custom_domains'
  ) denied();

  // Never trust merely the presence of a secret. Independently require
  // branch-specific Preview env metadata created before deployment.
  const envs = await get(
    await boundedFetch(
      fetcher,
      'https://api.vercel.com/v10/projects/' + PROJECT +
        '/env?teamId=' + TEAM +
        '&gitBranch=' + encodeURIComponent(BRANCH) + '&decrypt=false',
      v
    ),
    'env inventory'
  );
  for (const [key, value] of Object.entries({
    SUPABASE_URL: STAGING,
    NOVELIGHT_STAGING_SUPABASE_URL: STAGING,
    NOVELIGHT_AI_ADMIN_USER_ID: '00000000-0000-4000-8000-000000000943',
    NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED: 'true',
    NOVELIGHT_AI_REVIEW_ENABLED: 'true',
    NOVELIGHT_AI_ENABLED: 'false'
  })) {
    const matching = envs.envs?.filter((row) => row.key === key);
    if (
      matching?.length !== 1 ||
      matching[0].value !== value ||
      matching[0].type !== 'plain' ||
      matching[0].gitBranch !== BRANCH ||
      !matching[0].target?.includes('preview') ||
      matching[0].updatedAt > meta.createdAt
    ) denied();
  }
  for (const key of ['SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY']) {
    const matches = envs.envs?.filter((row) => row.key === key);
    if (
      matches?.length !== 1 ||
      matches[0].type !== 'sensitive' ||
      matches[0].gitBranch !== BRANCH ||
      !matches[0].target?.includes('preview') ||
      matches[0].updatedAt > meta.createdAt
    ) denied();
  }

  const protection = {
    'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET
  };
  const facts = await get(
    await boundedFetch(fetcher, config.origin + '/api/staging-environment-facts', protection),
    'staging facts'
  );
  if (
    facts.vercelEnv !== 'preview' ||
    facts.commitSha !== config.sha ||
    facts.appBaseUrl !== config.origin ||
    facts.supabase?.url !== STAGING ||
    facts.supabase?.serverSecretPresent !== true ||
    facts.stripe?.secretKeyMode !== 'test'
  ) denied();
  const browser = await get(
    await boundedFetch(fetcher, config.origin + '/api/staging-browser-config', protection),
    'browser configuration'
  );
  if (
    browser.supabaseUrl !== STAGING ||
    !/^sb_publishable_[a-zA-Z0-9_-]+$/u.test(browser.supabasePublishableKey || '')
  ) denied();
  const unauthenticated = await boundedFetch(
    fetcher,
    config.origin + '/api/ai-owner-bible-review?novel_id=998891003',
    protection
  );
  if (unauthenticated.status !== 401) denied();
  const noAi = await boundedFetch(
    fetcher,
    config.origin + '/api/ai-owner-bible-analyze?novel_id=998891003',
    protection
  );
  if (noAi.status !== 404) denied();
  if (config.staging === PRODUCTION) denied();
  return true;
}
