// Phase 2 exact deployment cleanup adapter. No CLI, runner or authorization
// minting. Requires an independently verified protected one-use grant.
const TEAM = 'team_2XFgtRCPJQ6pbrEa4mOLQAEx';
const PROJECT = 'prj_SmotUNrcyuUntdWTayzWeJ8eQGqe';
const BRANCH = 'feat/community-plaza-board-phase2-20261023';
const SCOPE = 'community-phase2-joint-hosted-authenticated-write';
const SHA = /^[a-f0-9]{40}$/u;
const DEPLOY_ID = /^dpl_[a-zA-Z0-9]+$/u;
const INTEGER_ID = /^[1-9][0-9]*$/u;

function deny() {
  throw new Error('PHASE2_PREVIEW_CLEANUP_DENIED');
}
function guard({ grant, target, token, fetchImpl }) {
  if (
    grant?.status !== 'INDEPENDENT_PROTECTED_EXECUTION_GRANT' ||
    grant.scope !== SCOPE ||
    grant.stagingCostApproved !== true ||
    grant.runAuthorized !== true ||
    grant.writeAuthorized !== true ||
    grant.protectedEnvironmentVerified !== true ||
    grant.oneUseBudgetCapEnforced !== true ||
    grant.productionExcluded !== true ||
    grant.productionMutationApproved !== false ||
    !INTEGER_ID.test(String(grant.runId || '')) ||
    !INTEGER_ID.test(String(grant.requestCommentId || '')) ||
    !SHA.test(grant.candidateSha || '') ||
    target?.candidateSha !== grant.candidateSha ||
    target?.runId !== String(grant.runId) ||
    target?.requestCommentId !== String(grant.requestCommentId) ||
    target?.teamId !== TEAM ||
    target?.projectId !== PROJECT ||
    target?.ref !== BRANCH ||
    !DEPLOY_ID.test(target?.deploymentId ?? '') ||
    typeof token !== 'string' ||
    token.length < 20 ||
    typeof fetchImpl !== 'function'
  ) deny();
}
function validateDeployment(raw, grant, target) {
  let parsed;
  try {
    parsed = new URL('https://' + raw?.url);
  } catch {
    deny();
  }
  const observedSha = raw?.meta?.githubCommitSha || raw?.gitSource?.sha;
  const observedBranch = raw?.meta?.githubCommitRef || raw?.gitSource?.ref;
  // Vercel's live v13 deployment response may provide nested project.id,
  // omit ownerId, and use null for a Preview target. TeamId is explicitly
  // bound on every authenticated request and the project ID is immutable.
  const nestedProjectId = raw?.project?.id;
  const projectId = nestedProjectId ?? raw?.projectId;
  const safeAliases = Array.isArray(raw?.alias) && raw.alias.every(
    (alias) =>
      typeof alias === 'string' &&
      /^[a-z0-9-]+\.vercel\.app$/u.test(alias) &&
      alias !== 'novelrise.vercel.app'
  );
  if (
    raw?.id !== target.deploymentId ||
    projectId !== PROJECT ||
    (nestedProjectId && raw?.projectId &&
      nestedProjectId !== raw.projectId) ||
    (raw?.ownerId && raw.ownerId !== TEAM) ||
    (raw?.target !== null && raw?.target !== 'preview') ||
    !safeAliases ||
    observedSha !== grant.candidateSha ||
    observedBranch !== BRANCH ||
    parsed.protocol !== 'https:' ||
    parsed.username || parsed.password || parsed.port ||
    parsed.pathname !== '/' || parsed.search || parsed.hash ||
    parsed.hostname === 'novelrise.vercel.app' ||
    !parsed.hostname.endsWith('.vercel.app')
  ) deny();
  return parsed.origin;
}

export async function disposePhase2IsolatedPreview({
  grant,
  target,
  token,
  fetchImpl = fetch
}) {
  guard({ grant, target, token, fetchImpl });
  const url = new URL(
    '/v13/deployments/' + target.deploymentId,
    'https://api.vercel.com'
  );
  url.searchParams.set('teamId', TEAM);
  const headers = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/json'
  };
  const first = await fetchImpl(url.href, {
    method: 'GET',
    redirect: 'error',
    headers
  });
  if (first?.status !== 200) deny();
  const data = await first.json();
  const origin = validateDeployment(data, grant, target);
  if (target.previewOrigin !== origin) deny();

  // The first authenticated GET proves this is the exact one-use deployment.
  // Never call a generic project deletion, alias deletion or --prod endpoint.
  const deleted = await fetchImpl(url.href, {
    method: 'DELETE',
    redirect: 'error',
    headers
  });
  if (deleted?.status !== 200) deny();
  const receipt = await deleted.json();
  if (receipt?.uid !== target.deploymentId || receipt?.state !== 'DELETED') {
    deny();
  }
  const after = await fetchImpl(url.href, {
    method: 'GET',
    redirect: 'error',
    headers
  });
  if (after?.status !== 404) deny();
  return Object.freeze({
    status: 'CONFIRMED_CLEAN',
    deletedId: target.deploymentId,
    previewOrigin: origin,
    productionTouched: false
  });
}
