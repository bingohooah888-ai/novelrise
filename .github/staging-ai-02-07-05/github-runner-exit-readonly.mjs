// AI 02-07-05 — dormant, read-only GitHub Actions runner-exit evidence.
// No scheduling, writes, secrets on import, paid provider, or Staging operations.
// Never infer synthetic cleanup, heartbeat, or paid-trial permission from GitHub.
const REPO = 'bingohooah888-ai/novelrise';
const API = 'https://api.github.com/repos/' + REPO;
const WORKFLOW = '.github/workflows/ai-020705-owner-staging-paid-trial.yml';
const OWNER = 'bingohooah888-ai';
const OWNER_ID = 317436651;
const SHA = /^[0-9a-f]{40}$/u;
const TERMINAL = new Set([
  'success', 'failure', 'cancelled', 'timed_out', 'skipped'
]);
const RUNNING = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);
const MAX_JOBS = 1000;
const PAGE_SIZE = 100;
const HEADERS = Object.freeze({
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'
});

function deny() {
  throw new Error('AI_020705_GITHUB_RUNNER_EXIT_DENIED');
}

function owner(actor) {
  return actor?.login === OWNER &&
    actor?.id === OWNER_ID &&
    actor?.type === 'User';
}

function validRun(run, scope) {
  return run?.id === scope.runId &&
    run?.repository?.full_name === REPO &&
    run?.path === WORKFLOW &&
    run?.event === 'workflow_dispatch' &&
    run?.head_branch === 'main' &&
    run?.head_sha === scope.mainSha &&
    run?.run_attempt === 1 &&
    run?.run_number > 0 &&
    Number.isSafeInteger(run.run_number) &&
    owner(run.actor) &&
    owner(run.triggering_actor) &&
    typeof run.created_at === 'string' &&
    typeof run.updated_at === 'string' &&
    Number.isFinite(Date.parse(run.created_at)) &&
    Number.isFinite(Date.parse(run.updated_at)) &&
    Date.parse(run.created_at) <= Date.parse(run.updated_at) &&
    (RUNNING.has(run.status) ||
      (run.status === 'completed' && TERMINAL.has(run.conclusion))) &&
    (run.status === 'completed' || run.conclusion == null);
}

function jobValid(job, scope, run) {
  return Number.isSafeInteger(job?.id) && job.id > 0 &&
    job.run_id === scope.runId &&
    job.run_attempt === 1 &&
    job.head_sha === scope.mainSha &&
    (
      (job.status === 'completed' && TERMINAL.has(job.conclusion)) ||
      (RUNNING.has(job.status) && job.conclusion == null)
    ) &&
    typeof job.started_at === 'string' &&
    Number.isFinite(Date.parse(job.started_at)) &&
    Date.parse(job.started_at) >= Date.parse(run.created_at) &&
    (
      job.status !== 'completed' ||
      (
        typeof job.completed_at === 'string' &&
        Number.isFinite(Date.parse(job.completed_at)) &&
        Date.parse(job.completed_at) >= Date.parse(job.started_at)
      )
    );
}

/**
 * Only a separately authorized, least-privilege actions:read GitHub token
 * may be supplied by a protected independent controller. This exports
 * observation ONLY, not any supervisor permission or action callback.
 * All URLs are constructed from validated IDs and a fixed allowlisted host.
 */
export async function read020705GithubRunnerExit({
  token,
  scope,
  fetchImpl = globalThis.fetch,
  now = Date.now
} = {}) {
  if (
    scope?.repository !== REPO ||
    scope?.workflowPath !== WORKFLOW ||
    !Number.isSafeInteger(scope?.runId) || scope.runId < 1 ||
    !SHA.test(scope?.mainSha ?? '') ||
    typeof token !== 'string' || token.length < 12 || token.length > 4096 ||
    typeof fetchImpl !== 'function' ||
    typeof now !== 'function'
  ) deny();

  const started = now();
  if (!Number.isFinite(started)) deny();
  const runUrl = API + '/actions/runs/' + scope.runId;
  const jobsBase = runUrl + '/jobs?per_page=' + PAGE_SIZE + '&page=';
  let run;
  let jobs;
  let rechecked;

  try {
    async function get(url) {
      // Permit only this one run and its bounded, integer page numbers.
      const pageText = url.startsWith(jobsBase)
        ? url.slice(jobsBase.length) : '';
      const validJobPage = /^[1-9][0-9]*$/u.test(pageText) &&
        Number(pageText) <= Math.ceil(MAX_JOBS / PAGE_SIZE);
      if (url !== runUrl && !validJobPage) deny();
      const response = await fetchImpl(url, {
        method: 'GET', redirect: 'error',
        headers: { ...HEADERS, Authorization: 'Bearer ' + token }
      });
      if (response?.status !== 200 || typeof response.json !== 'function')
        deny();
      return response.json();
    }

    run = await get(runUrl);
    if (!validRun(run, scope)) deny();
    const firstPage = await get(jobsBase + '1');
    const count = firstPage?.total_count;
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_JOBS ||
        !Array.isArray(firstPage?.jobs)) deny();

    const pages = Math.ceil(count / PAGE_SIZE);
    jobs = [...firstPage.jobs];
    if (firstPage.jobs.length !== Math.min(count, PAGE_SIZE)) deny();
    for (let page = 2; page <= pages; page++) {
      const result = await get(jobsBase + page);
      const expectedLength = Math.min(PAGE_SIZE, count - (page - 1) * PAGE_SIZE);
      if (result?.total_count !== count ||
          !Array.isArray(result.jobs) ||
          result.jobs.length !== expectedLength) deny();
      jobs.push(...result.jobs);
    }

    // Check the complete job list twice. The first run re-read alone
    // cannot detect a job that changes status after page collection.
    // Preserve identity, ordering, status, conclusion, and timestamps.
    const jobFingerprint = (job) => JSON.stringify([
      job.id, job.run_id, job.run_attempt, job.head_sha,
      job.status, job.conclusion, job.started_at, job.completed_at
    ]);
    const seen = new Set();
    for (const job of jobs) {
      if (!jobValid(job, scope, run) || seen.has(job.id)) deny();
      seen.add(job.id);
    }

    const secondJobs = [];
    for (let page = 1; page <= pages; page++) {
      const result = await get(jobsBase + page);
      const expectedLength = Math.min(PAGE_SIZE, count - (page - 1) * PAGE_SIZE);
      if (result?.total_count !== count ||
          !Array.isArray(result.jobs) ||
          result.jobs.length !== expectedLength) deny();
      secondJobs.push(...result.jobs);
    }
    if (secondJobs.length !== jobs.length ||
        secondJobs.some((job, i) =>
          !jobValid(job, scope, run) ||
          jobFingerprint(job) !== jobFingerprint(jobs[i]))) deny();

    // Re-read the run LAST, after both complete job snapshots, to
    // reject transitions observed while the job pages were fetched.
    rechecked = await get(runUrl);
    if (!validRun(rechecked, scope) ||
        rechecked.status !== run.status ||
        rechecked.conclusion !== run.conclusion ||
        rechecked.updated_at !== run.updated_at) deny();
    const ended = now();
    if (!Number.isFinite(ended) || ended < started ||
        ended - started > 30000) deny();

    const terminal = run.status === 'completed' &&
      jobs.every(job => job.status === 'completed');
    if (run.status === 'completed' && !terminal) deny();

    return Object.freeze({
      repository: REPO,
      runId: scope.runId,
      mainSha: scope.mainSha,
      workflowPath: WORKFLOW,
      status: run.status,
      conclusion: terminal ? run.conclusion : null,
      terminalRunnerExitVerified: terminal,
      observedAtMs: ended,
      jobCount: count,
      runAttempt: 1,
      // GitHub workflow exit is not proof of the synthetic ledger scope,
      // heartbeat, database, cleanup, or Staging environment disabled.
      independentHeartbeatVerified: false,
      syntheticScopeVerified: false,
      cleanupVerified: false,
      noPaidRetry: true,
      authorizesPaidCall: false,
      authorizesMutation: false
    });
  } catch {
    // Never emit API errors, token or content from GitHub into logs.
    deny();
  }
}
