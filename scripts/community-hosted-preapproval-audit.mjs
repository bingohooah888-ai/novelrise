// Read-only, approval-independent inventory for Community hosted acceptance.
// No write API, execution grant, claim, Preview, Supabase or Vercel call.
// GitHub GET evidence is not a provider billing guarantee.
import { assertReviewedCommunityCandidate } from './community-phase1-reviewed-candidate.mjs';

const REPO = 'bingohooah888-ai/novelrise';
const API = 'https://api.github.com/repos/' + REPO;
const OWNER = 'bingohooah888-ai';
const SHA = /^[a-f0-9]{40}$/u;
const WATCHDOG = 'community-hosted-expiry-watchdog.yml';
const ISOLATED_ENV = 'community-hosted-isolated';
const CLEANUP_ENV = 'community-hosted-cleanup';
const FRESH_MS = 15 * 60 * 1000;

function independentEnvironment(env, policies) {
  const rules = env?.protection_rules;
  return env?.name === ISOLATED_ENV &&
    env.prevent_self_review === true &&
    env.can_admins_bypass === false &&
    env.deployment_branch_policy?.protected_branches === false &&
    env.deployment_branch_policy?.custom_branch_policies === true &&
    Array.isArray(rules) &&
    rules.some((rule) => rule.type === 'required_reviewers' &&
      rule.reviewers?.some((person) =>
        person?.type === 'User' &&
        typeof person.reviewer?.login === 'string' &&
        person.reviewer.login !== OWNER)) &&
    mainOnlyPolicy(policies);
}

function mainOnlyPolicy(policies) {
  return policies?.total_count === 1 &&
    Array.isArray(policies.branch_policies) &&
    policies.branch_policies.length === 1 &&
    policies.branch_policies[0]?.name === 'main' &&
    policies.branch_policies[0]?.type === 'branch';
}

function independentCleanup(env, policies) {
  return env?.name === CLEANUP_ENV &&
    env.deployment_branch_policy?.protected_branches === false &&
    env.deployment_branch_policy?.custom_branch_policies === true &&
    Array.isArray(env.protection_rules) &&
    !env.protection_rules.some((rule) =>
      ['required_reviewers', 'wait_timer'].includes(rule?.type)) &&
    mainOnlyPolicy(policies);
}

function recent(timestamp, now) {
  const time = Date.parse(timestamp);
  return Number.isFinite(time) && time <= now && now - time <= FRESH_MS;
}

export async function auditCommunityHostedNoCostReadiness({
  expectedMainSha,
  githubToken,
  fetchImpl = fetch,
  now = Date.now()
}) {
  if (!SHA.test(expectedMainSha ?? '') ||
      typeof githubToken !== 'string' ||
      githubToken.length < 32 ||
      typeof fetchImpl !== 'function' ||
      !Number.isSafeInteger(now)) {
    throw new Error('COMMUNITY_PREAPPROVAL_READ_DENIED');
  }

  async function get(path) {
    // Every request is an authenticated GET. Non-200 results are unavailable,
    // not authorization evidence. Do not log bodies, headers or tokens.
    try {
      const response = await fetchImpl(API + path, {
        method: 'GET',
        redirect: 'error',
        headers: {
          Authorization: 'Bearer ' + githubToken,
          Accept: 'application/vnd.github+json'
        },
        signal: AbortSignal.timeout(15000)
      });
      if (response?.status !== 200) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  const [main, feature, issue, runner, runnerPolicy, cleanup, cleanupPolicy,
    watchdog, variable] = await Promise.all([
    get('/git/ref/heads/main'),
    get('/pulls/2222'),
    get('/issues/188'),
    get('/environments/' + ISOLATED_ENV),
    get('/environments/' + ISOLATED_ENV +
      '/deployment-branch-policies?per_page=100'),
    get('/environments/' + CLEANUP_ENV),
    get('/environments/' + CLEANUP_ENV +
      '/deployment-branch-policies?per_page=100'),
    get('/actions/workflows/' + WATCHDOG),
    get('/actions/variables/NOVELIGHT_COMMUNITY_WATCHDOG_ENABLED')
  ]);
  const checks = {
    trustedMain: main?.object?.sha === expectedMainSha,
    candidateReview: false,
    costGateClosed: issue?.state === 'closed' && issue?.number === 188,
    independentEnvironment: independentEnvironment(runner, runnerPolicy),
    cleanupEnvironment: independentCleanup(cleanup, cleanupPolicy),
    watchdogConfigured: watchdog?.state === 'active' &&
      watchdog.path === '.github/workflows/' + WATCHDOG &&
      variable?.name === 'NOVELIGHT_COMMUNITY_WATCHDOG_ENABLED' &&
      variable.value === 'true',
    recentCleanupJob: false
  };

  let candidateSha = null;
  if (checks.trustedMain && feature?.state === 'open' &&
      feature.draft === true && feature.merged !== true &&
      feature.number === 2222 &&
      feature.base?.sha === expectedMainSha &&
      feature.head?.repo?.full_name === REPO &&
      SHA.test(feature.head?.sha ?? '')) {
    candidateSha = feature.head.sha;
    const compare = await get('/compare/' + expectedMainSha +
      '...' + candidateSha + '?per_page=250');
    try {
      assertReviewedCommunityCandidate({
        mainSha: expectedMainSha, candidateSha, compare
      });
      checks.candidateReview = true;
    } catch {
      // A missing, incomplete or mismatched comparison is not verified.
    }
  }

  if (checks.trustedMain && checks.cleanupEnvironment &&
      checks.watchdogConfigured) {
    const runs = await get('/actions/workflows/' + watchdog.id +
      '/runs?event=schedule&branch=main&per_page=20');
    const match = Array.isArray(runs?.workflow_runs) &&
      runs.workflow_runs.length <= 20 &&
      runs.workflow_runs.find((run) =>
        run.event === 'schedule' &&
        run.head_sha === expectedMainSha &&
        run.head_branch === 'main' &&
        run.status === 'completed' &&
        run.conclusion === 'success' &&
        recent(run.created_at, now));
    if (match && Number.isSafeInteger(match.id) && match.id > 0) {
      const jobs = await get('/actions/runs/' + match.id + '/jobs?per_page=100');
      checks.recentCleanupJob = Array.isArray(jobs?.jobs) &&
        jobs.jobs.length <= 100 && jobs.jobs.some((job) =>
          job.name === 'cleanup' && job.status === 'completed' &&
          job.conclusion === 'success' &&
          recent(job.completed_at, now));
    }
  }

  const blockers = Object.entries(checks)
    .filter(([, value]) => value !== true)
    .map(([name]) => name);
  // Provider billing limits and owned-branch creation/deletion still require
  // separate, authenticated live evidence. Never claim an executable verdict.
  blockers.push('providerBillingAndIsolationUnverified');
  return Object.freeze({
    status: 'READ_ONLY_APPROVAL_PREPARATION_BLOCKED',
    mainSha: expectedMainSha,
    candidateSha,
    checks,
    blockers,
    issue188State: issue?.state === 'closed' ? 'closed' :
      issue?.state === 'open' ? 'open' : 'unverified',
    stagingCostApproved: false,
    mayClaim: false,
    mayCreateBranch: false,
    mayDeployPreview: false,
    mayRunBrowser: false,
    writeAuthorized: false,
    releaseAuthorized: false
  });
}

if (process.argv[2] === 'inspect') {
  try {
    if (process.env.GITHUB_ACTIONS !== 'true' ||
        process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
        process.env.GITHUB_REPOSITORY !== REPO ||
        process.env.GITHUB_REF !== 'refs/heads/main' ||
        process.env.GITHUB_ACTOR !== OWNER ||
        process.env.GITHUB_TRIGGERING_ACTOR !== OWNER ||
        !SHA.test(process.env.GITHUB_SHA ?? '')) {
      throw new Error('untrusted runner');
    }
    const result = await auditCommunityHostedNoCostReadiness({
      expectedMainSha: process.env.GITHUB_SHA,
      githubToken: process.env.COMMUNITY_GITHUB_READ_TOKEN
    });
    console.log(JSON.stringify(result));
    if (process.env.GITHUB_STEP_SUMMARY) {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        '### Community hosted: read-only, blocked\n\n' +
        'No spending, claim or deployment is authorized.\n\n' +
        'Observed blockers: ' + result.blockers.join(', ') + '\n');
    }
  } catch {
    console.error('COMMUNITY_PREAPPROVAL_READ_DENIED');
    process.exitCode = 1;
  }
}
