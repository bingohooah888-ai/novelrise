// Live authenticated evidence of an independent cleanup schedule.
// No permission issuance, resource creation, approval or billing guarantee.
const REPO = 'bingohooah888-ai/novelrise';
const API = 'https://api.github.com/repos/' + REPO;
const WORKFLOW = 'community-hosted-expiry-watchdog.yml';
const ENV = 'community-hosted-cleanup';
const SHA = /^[a-f0-9]{40}$/u;
const FRESH_MS = 15 * 60000;

function deny() {
  throw new Error('COMMUNITY_WATCHDOG_LIVE_DENIED');
}

async function get(fetchImpl, token, path) {
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

function fresh(value, now) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) &&
    timestamp <= now && now - timestamp <= FRESH_MS;
}

export async function readCommunityWatchdogLiveEvidence({
  githubToken,
  mainSha,
  now = Date.now(),
  fetchImpl = fetch
}) {
  if (
    typeof githubToken !== 'string' ||
    githubToken.length < 32 ||
    !SHA.test(mainSha ?? '') ||
    !Number.isSafeInteger(now) ||
    typeof fetchImpl !== 'function'
  ) deny();

  const main = await get(fetchImpl, githubToken, '/git/ref/heads/main');
  if (main?.object?.sha !== mainSha) deny();

  const workflow = await get(
    fetchImpl, githubToken, '/actions/workflows/' + WORKFLOW
  );
  if (
    !Number.isSafeInteger(workflow?.id) ||
    workflow.id <= 0 ||
    workflow.state !== 'active' ||
    workflow.path !== '.github/workflows/' + WORKFLOW
  ) deny();

  const variable = await get(
    fetchImpl, githubToken,
    '/actions/variables/NOVELIGHT_COMMUNITY_WATCHDOG_ENABLED'
  );
  if (
    variable?.name !== 'NOVELIGHT_COMMUNITY_WATCHDOG_ENABLED' ||
    variable.value !== 'true'
  ) deny();

  const environment = await get(
    fetchImpl, githubToken, '/environments/' + ENV
  );
  const policies = await get(
    fetchImpl, githubToken,
    '/environments/' + ENV + '/deployment-branch-policies?per_page=100'
  );
  if (
    environment?.name !== ENV ||
    environment.deployment_branch_policy?.protected_branches !== false ||
    environment.deployment_branch_policy?.custom_branch_policies !== true ||
    !Array.isArray(environment.protection_rules) ||
    environment.protection_rules.some((rule) =>
      ['required_reviewers', 'wait_timer'].includes(rule?.type)
    ) ||
    policies?.total_count !== 1 ||
    policies.branch_policies?.length !== 1 ||
    policies.branch_policies[0]?.name !== 'main' ||
    policies.branch_policies[0]?.type !== 'branch'
  ) deny();

  const runs = await get(
    fetchImpl, githubToken,
    '/actions/workflows/' + workflow.id +
      '/runs?event=schedule&branch=main&per_page=20'
  );
  if (
    !Array.isArray(runs?.workflow_runs) ||
    runs.workflow_runs.length > 20
  ) deny();
  const recent = runs.workflow_runs.find((run) =>
    Number.isSafeInteger(run.id) &&
    run.id > 0 &&
    run.event === 'schedule' &&
    run.head_branch === 'main' &&
    run.head_sha === mainSha &&
    run.status === 'completed' &&
    run.conclusion === 'success' &&
    fresh(run.created_at, now)
  );
  if (!recent) deny();

  const jobs = await get(
    fetchImpl, githubToken,
    '/actions/runs/' + recent.id + '/jobs?per_page=100'
  );
  if (
    !Array.isArray(jobs?.jobs) ||
    jobs.jobs.length > 100 ||
    !jobs.jobs.some((job) =>
      job.name === 'cleanup' &&
      job.status === 'completed' &&
      job.conclusion === 'success' &&
      fresh(job.completed_at, now)
    )
  ) deny();

  // A single successful scheduled cleanup is live evidence, NOT a guarantee
  // of future cron timing or a provider-enforced spend hard stop.
  return Object.freeze({
    status: 'INDEPENDENT_CLEANUP_WATCHDOG_LIVE',
    mainSha,
    workflowRunId: String(recent.id),
    workloadIndependentOfBrowser: true,
    cleanupEnvironmentProtected: true,
    scheduleEnabledVerified: true,
    maxMinutes: 120,
    graceMinutes: 15,
    observedAt: now
  });
}
