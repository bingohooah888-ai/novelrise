// 02-07-05: exactly one approved Vercel Preview creation/attestation.
// Importing or constructing this module cannot deploy, read secrets or
// activate AI. The trusted runner must verify OWNER's one-use scope first.
const REPO = 'bingohooah888-ai/novelrise';
const STAGING = 'wmlzjgvxgoyrovdhbqbg';
const SUPABASE = 'https://' + STAGING + '.supabase.co';
const SHA = /^[0-9a-f]{40}$/u;
const DEPLOYMENT = /^dpl_[A-Za-z0-9]+$/u;
const REQUIRED_BRANCH_KEYS = Object.freeze([
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'NOVELIGHT_STAGING_SUPABASE_URL',
  'NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY',
  'NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED',
  'NOVELIGHT_AI_OWNER_REVIEW_STATE_ENABLED',
  'NOVELIGHT_AI_020705_STAGING_PREVIEW_ENABLED',
  'NOVELIGHT_AI_020705_ONE_SHOT_ENABLED'
]);

function deny() {
  throw new Error('AI_020705_STAGING_PREVIEW_DENIED');
}

export function create020705StagingPreviewAdapter({
  scope,
  token,
  projectId,
  teamId,
  protectionBypass,
  existingDeploymentId = null,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
  if (scope?.repository !== REPO ||
      scope?.stagingProjectRef !== STAGING ||
      scope?.supabaseUrl !== SUPABASE ||
      scope?.maxPreviews !== 1 ||
      !SHA.test(scope?.candidateSha ?? '') ||
      !/^staging\/ai-02-07-05-[a-z0-9-]+$/u.test(scope?.stagingBranch ?? '') ||
      typeof token !== 'string' || token.length < 16 ||
      typeof projectId !== 'string' || !/^prj_[A-Za-z0-9]+$/u.test(projectId) ||
      (teamId != null && !/^team_[A-Za-z0-9]+$/u.test(teamId)) ||
      typeof protectionBypass !== 'string' || protectionBypass.length < 16 ||
      (existingDeploymentId !== null && !DEPLOYMENT.test(existingDeploymentId)) ||
      typeof fetchImpl !== 'function' || typeof sleep !== 'function') deny();

  const suffix = teamId ? '?teamId=' + encodeURIComponent(teamId) : '';
  const base = 'https://api.vercel.com';
  let attempted = false;

  async function request(url, { method = 'GET', payload, authorization = token } = {}) {
    if (!url.startsWith(base + '/') ||
        !/^https:\/\/api\.vercel\.com\/v(?:9|13)\//u.test(url)) deny();
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        redirect: 'error',
        headers: {
          Authorization: 'Bearer ' + authorization,
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json' } : {})
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        signal: AbortSignal.timeout(20000)
      });
      if (response.status !== 200 && response.status !== 201) deny();
      return await response.json();
    } catch {
      deny();
    }
  }

  async function provePreview(id, hostname) {
    if (!DEPLOYMENT.test(id) ||
        typeof hostname !== 'string' ||
        !/^[a-z0-9-]+\.vercel\.app$/u.test(hostname)) deny();
    const origin = 'https://' + hostname;
    // Explicit protection test: direct unauthenticated access must be
    // rejected, followed by a bypassed request bound to the exact SHA.
    const revision = origin + '/api/deployment-revision';
    let blocked;
    let authorized;
    let browser;
    try {
      blocked = await fetchImpl(revision, {
        redirect: 'error', signal: AbortSignal.timeout(10000)
      });
      if (![401, 403].includes(blocked.status)) deny();
      authorized = await fetchImpl(revision, {
        headers: { 'x-vercel-protection-bypass': protectionBypass },
        redirect: 'error', signal: AbortSignal.timeout(10000)
      });
      if (authorized.status !== 200) deny();
      const revisionBody = await authorized.json();
      if (revisionBody?.commitSha !== scope.candidateSha) deny();
      browser = await fetchImpl(origin + '/api/staging-browser-config', {
        headers: { 'x-vercel-protection-bypass': protectionBypass },
        redirect: 'error', signal: AbortSignal.timeout(10000)
      });
      if (browser.status !== 200) deny();
      const config = await browser.json();
      if (config?.supabaseUrl !== SUPABASE ||
          typeof config?.supabasePublishableKey !== 'string' ||
          !config.supabasePublishableKey.startsWith('sb_publishable_') ||
          config.supabasePublishableKey.includes('secret')) deny();
    } catch {
      deny();
    }
    return true;
  }

  async function run() {
    if (attempted) deny();
    attempted = true;
    const project = await request(base + '/v9/projects/' + projectId + suffix);
    if (project?.id !== projectId ||
        project?.name !== 'novelrise' ||
        project?.link?.type !== 'github' ||
        !Number.isSafeInteger(project.link.repoId) ||
        ![REPO, 'novelrise'].includes(project.link.repo)) deny();
    const env = await request(
      base + '/v9/projects/' + projectId + '/env' + suffix
    );
    if (!Array.isArray(env?.envs)) deny();
    const scoped = new Set(env.envs.filter((item) =>
      item?.gitBranch === scope.stagingBranch &&
      Array.isArray(item.target) &&
      item.target.includes('preview')
    ).map((item) => item.key));
    if (REQUIRED_BRANCH_KEYS.some((name) => !scoped.has(name))) deny();
    // Existing, separately approved Preview is a read-only operation.
    // A paid OWNER approval names its exact ID before any synthetic fixture
    // can be created; never silently create a different deployment instead.
    let id = existingDeploymentId;
    if (id === null) {
      const creation = await request(
        base + '/v13/deployments' + suffix,
        {
          method: 'POST',
          payload: {
            name: 'novelrise',
            project: projectId,
            gitSource: {
              type: 'github',
              repoId: project.link.repoId,
              ref: scope.stagingBranch,
              sha: scope.candidateSha
            }
          }
        }
      );
      id = creation?.id;
    }
    if (!DEPLOYMENT.test(id ?? '')) deny();
    let deployed;
    for (let i = 0; i < 10; i += 1) {
      deployed = await request(
        base + '/v13/deployments/' + id +
        (teamId ? '?teamId=' + encodeURIComponent(teamId) +
          '&withGitRepoInfo=true' : '?withGitRepoInfo=true')
      );
      if (deployed?.readyState === 'READY') break;
      if (['ERROR', 'CANCELED', 'CANCELLED'].includes(deployed?.readyState)) deny();
      if (i < 9) await sleep(12000);
    }
    if (deployed?.id !== id || deployed?.readyState !== 'READY' ||
        deployed?.projectId !== projectId ||
        deployed?.target === 'production' ||
        deployed?.gitSource?.sha !== scope.candidateSha ||
        deployed?.gitSource?.ref !== scope.stagingBranch ||
        !(await provePreview(id, deployed.url))) deny();

    return Object.freeze({
      id,
      ready: true,
      target: 'preview',
      gitCommitSha: scope.candidateSha,
      gitBranch: scope.stagingBranch,
      supabaseUrl: SUPABASE,
      projectRef: STAGING,
      ssoProtected: true
    });
  }
  return Object.freeze({ preparePreview: run });
}
