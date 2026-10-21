// Trusted main read-only protected-runner readiness inspection.
// This is NOT an execution grant, cost approval or branch provisioning path.
// All GitHub facts are fetched with the separately configured read-only token.
const REPO = 'bingohooah888-ai/novelrise';
const API = 'https://api.github.com/repos/' + REPO;
const OWNER = 'bingohooah888-ai';
const SCOPE = 'community-phase1-hosted-authenticated-write';
const MARKER = 'NOVELIGHT_STAGING_COMMUNITY_HOSTED_PRE_COST_APPROVE ';
const TITLE = '[Staging Approval Control] Preview / Staging cost gate';
const ENV = 'community-hosted-isolated';
const SHA = /^[a-f0-9]{40}$/u;
const ID = /^[1-9][0-9]*$/u;

function deny() {
  throw new Error('COMMUNITY_HOSTED_PROTECTED_READINESS_DENIED');
}

async function read(fetchImpl, token, path) {
  let response;
  try {
    response = await fetchImpl(API + path, {
      method: 'GET',
      redirect: 'error',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json'
      },
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    deny();
  }
  if (response?.status !== 200) deny();
  try {
    return await response.json();
  } catch {
    deny();
  }
}

function matchesApproval(comment, issue, mainSha, candidateSha) {
  if (
    comment?.user?.login !== OWNER ||
    comment.author_association !== 'OWNER' ||
    comment.issue_url !== API + '/issues/188' ||
    typeof comment.body !== 'string' ||
    !comment.body.startsWith(MARKER) ||
    issue?.number !== 188 ||
    issue?.state !== 'open' ||
    issue.title !== TITLE ||
    issue.user?.login !== OWNER ||
    issue.pull_request
  ) deny();
  let data;
  try {
    data = JSON.parse(comment.body.slice(MARKER.length));
  } catch {
    deny();
  }
  if (
    !data ||
    Array.isArray(data) ||
    Object.keys(data).sort().join(',') !==
      'confirmation,featureSha,mainSha,scope,target' ||
    data.confirmation !== 'STAGING COST APPROVED' ||
    data.scope !== SCOPE ||
    data.target !== 'new-data-less-isolated-branch' ||
    data.mainSha !== mainSha ||
    data.featureSha !== candidateSha
  ) deny();
}

function protect(environment, policies) {
  const reviewers = environment?.protection_rules?.filter(
    (rule) => rule?.type === 'required_reviewers'
  );
  if (
    environment?.name !== ENV ||
    environment.prevent_self_review !== true ||
    environment.can_admins_bypass !== false ||
    environment.deployment_branch_policy?.protected_branches !== false ||
    environment.deployment_branch_policy?.custom_branch_policies !== true ||
    !Array.isArray(reviewers) ||
    !reviewers.some((rule) =>
      rule.reviewers?.some((person) =>
        person.type === 'User' &&
        typeof person.reviewer?.login === 'string' &&
        person.reviewer.login !== OWNER
      )
    ) ||
    policies?.total_count !== 1 ||
    policies.branch_policies?.length !== 1 ||
    policies.branch_policies[0]?.name !== 'main' ||
    policies.branch_policies[0]?.type !== 'branch'
  ) deny();
}

export async function inspectProtectedRunnerReadiness({
  mainSha,
  candidateSha,
  commentId,
  runId,
  token,
  fetchImpl = fetch
}) {
  if (
    !SHA.test(mainSha ?? '') ||
    !SHA.test(candidateSha ?? '') ||
    mainSha === candidateSha ||
    !ID.test(commentId ?? '') ||
    !ID.test(runId ?? '') ||
    typeof token !== 'string' ||
    token.length < 32 ||
    typeof fetchImpl !== 'function'
  ) deny();

  const main = await read(fetchImpl, token, '/git/ref/heads/main');
  if (main?.object?.sha !== mainSha) deny();
  const feature = await read(fetchImpl, token, '/pulls/2222');
  if (
    feature?.head?.sha !== candidateSha ||
    feature.base?.sha !== mainSha ||
    feature.state !== 'open' ||
    feature.draft !== true ||
    feature.merged === true
  ) deny();

  const run = await read(fetchImpl, token, '/actions/runs/' + runId);
  if (
    String(run?.id) !== runId ||
    run.event !== 'issue_comment' ||
    run.head_sha !== mainSha ||
    run.head_branch !== 'main' ||
    run.path !== '.github/workflows/community-hosted-executor.yml' ||
    run.actor?.login !== OWNER ||
    run.triggering_actor?.login !== OWNER ||
    run.run_attempt !== 1
  ) deny();

  const issue = await read(fetchImpl, token, '/issues/188');
  const comment = await read(
    fetchImpl, token, '/issues/comments/' + commentId
  );
  if (String(comment?.id) !== commentId) deny();
  matchesApproval(comment, issue, mainSha, candidateSha);

  const environment = await read(
    fetchImpl, token, '/environments/' + ENV
  );
  const policies = await read(
    fetchImpl, token,
    '/environments/' + ENV + '/deployment-branch-policies?per_page=100'
  );
  protect(environment, policies);

  // Read-only proof cannot substitute for the later independent budget,
  // one-use CLAIM, cleanup watchdog, or actual protected-job approval.
  return Object.freeze({
    status: 'AUTHENTICATED_PROTECTED_READINESS_ONLY',
    mainSha,
    candidateSha,
    requestCommentId: commentId,
    runId,
    githubEnvironmentReadVerified: true,
    ownerRequestReadVerified: true,
    protectedJobApproved: false,
    oneUseBudgetApproved: false,
    cleanupWatchLiveVerified: false,
    stagingCostApproved: false,
    runAuthorized: false,
    writeAuthorized: false,
    releaseAuthorized: false
  });
}

if (process.argv[2] === 'inspect') {
  try {
    const args = process.argv.slice(3);
    if (
      args.length !== 4 ||
      process.env.GITHUB_ACTIONS !== 'true' ||
      process.env.GITHUB_REPOSITORY !== REPO ||
      process.env.GITHUB_REF !== 'refs/heads/main' ||
      process.env.GITHUB_SHA !== args[0] ||
      process.env.GITHUB_RUN_ID !== args[3] ||
      process.env.GITHUB_WORKFLOW_REF !==
        REPO + '/.github/workflows/community-hosted-executor.yml@refs/heads/main'
    ) deny();
    const result = await inspectProtectedRunnerReadiness({
      mainSha: args[0],
      candidateSha: args[1],
      commentId: args[2],
      runId: args[3],
      token: process.env.COMMUNITY_PROTECTION_READ_TOKEN
    });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch {
    console.error('COMMUNITY_HOSTED_PROTECTED_READINESS_DENIED');
    process.exitCode = 1;
  }
}
