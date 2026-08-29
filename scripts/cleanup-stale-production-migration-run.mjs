import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const BOT_LOGIN = 'github-actions[bot]';
const BASELINE_VERSION = '20260815000000';
const DISPATCH_PREFIX = 'NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_DISPATCHED ';

function safetyStop(message) {
  throw new Error(`Safety stop: ${message}`);
}

function isCanonicalMigrationList(migrations) {
  if (!Array.isArray(migrations) || migrations.length < 1 || migrations.length > 20) {
    return false;
  }

  if (!migrations.every((version) => /^[0-9]{14}$/.test(version))) {
    return false;
  }

  if (migrations.includes(BASELINE_VERSION)) {
    return false;
  }

  const canonical = [...new Set(migrations)].sort();
  return (
    canonical.length === migrations.length &&
    canonical.every((version, index) => version === migrations[index])
  );
}

function parsePriorMigrationDispatch(comment) {
  const body = comment?.body;
  if (typeof body !== 'string' || !body.startsWith(DISPATCH_PREFIX)) {
    return null;
  }

  try {
    return JSON.parse(body.slice(DISPATCH_PREFIX.length));
  } catch {
    return null;
  }
}

export function selectStaleMigrationRunForCleanup({
  runs,
  ledgerComments,
  expectedMainSha,
  manualWorkflow = 'supabase-production.yml',
}) {
  if (!/^[0-9a-f]{40}$/.test(expectedMainSha)) {
    safetyStop('expected main SHA must be exactly 40 lowercase hex characters.');
  }

  if (!Array.isArray(runs) || !Array.isArray(ledgerComments)) {
    safetyStop('GitHub run or ledger data is malformed.');
  }

  const activeRuns = runs.filter((run) => run?.status !== 'completed');
  const humanActiveRuns = activeRuns.filter(
    (run) => run?.actor?.login !== BOT_LOGIN
  );
  if (humanActiveRuns.length !== 0) {
    safetyStop('a human-started Supabase Production workflow is still active.');
  }

  const unexpectedBotRuns = activeRuns.filter(
    (run) => run?.actor?.login === BOT_LOGIN && run?.event !== 'workflow_dispatch'
  );
  if (unexpectedBotRuns.length !== 0) {
    safetyStop('an unexpected bot-started Supabase Production workflow is active.');
  }

  const botActiveRuns = activeRuns.filter(
    (run) => run?.actor?.login === BOT_LOGIN && run?.event === 'workflow_dispatch'
  );
  if (botActiveRuns.length > 1) {
    safetyStop(
      'multiple stale bot-dispatched Production migration runs require manual investigation.'
    );
  }

  if (botActiveRuns.length === 0) {
    return null;
  }

  const staleRun = botActiveRuns[0];
  if (staleRun.status !== 'waiting') {
    safetyStop(
      `the only active bot-dispatched Production migration run is ${staleRun.status}, not waiting.`
    );
  }

  if (!/^[0-9a-f]{40}$/.test(staleRun.head_sha ?? '')) {
    safetyStop('active bot Production migration run has an invalid head SHA.');
  }

  if (staleRun.head_sha === expectedMainSha) {
    safetyStop(
      'a bot-dispatched Production migration run already exists for the requested main.'
    );
  }

  const matchingDispatches = ledgerComments
    .map(parsePriorMigrationDispatch)
    .filter(Boolean)
    .filter(
      (record) =>
        record.operation === 'supabase-migration-deploy' &&
        record.mainSha === staleRun.head_sha &&
        record.targetWorkflow === manualWorkflow &&
        typeof record.challenge === 'string' &&
        /^[A-F0-9]{8}$/.test(record.challenge) &&
        typeof record.bridgeRunId === 'string' &&
        /^[0-9]+$/.test(record.bridgeRunId) &&
        isCanonicalMigrationList(record.migrations)
    );

  if (matchingDispatches.length !== 1) {
    safetyStop(
      'active bot Production migration run is not uniquely backed by the prior bridge ledger.'
    );
  }

  return staleRun;
}

async function githubRequest(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub API request failed (${response.status}) for ${url}: ${body}`
    );
  }

  return response;
}

async function waitForCancelledRun({
  request,
  sleep,
  apiBase,
  staleRun,
  token,
  pollAttempts,
  pollDelayMs,
}) {
  let lastRun = null;

  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    const runResponse = await request(
      `${apiBase}/actions/runs/${staleRun.id}`,
      token
    );
    const run = await runResponse.json();
    lastRun = run;

    if (run.head_sha !== staleRun.head_sha) {
      safetyStop('stale Production migration run head SHA changed unexpectedly.');
    }

    if (run.status === 'completed') {
      if (run.conclusion === 'cancelled') {
        return { cancelled: true, lastRun: run };
      }

      safetyStop(
        `stale Production migration run completed with ${run.conclusion ?? 'unknown'} while cancellation was pending.`
      );
    }

    await sleep(pollDelayMs);
  }

  return { cancelled: false, lastRun };
}

export async function cancelStaleProductionMigrationRun({
  request = githubRequest,
  sleep = delay,
  apiBase,
  staleRun,
  token,
  pollAttempts = 20,
  pollDelayMs = 2000,
}) {
  if (!apiBase || !staleRun?.id || !/^[0-9a-f]{40}$/.test(staleRun.head_sha ?? '')) {
    safetyStop('stale Production migration run cancellation input is invalid.');
  }

  const cancelResponse = await request(
    `${apiBase}/actions/runs/${staleRun.id}/cancel`,
    token,
    { method: 'POST' }
  );
  if (cancelResponse.status !== 202) {
    safetyStop(
      `stale Production migration run cancellation returned HTTP ${cancelResponse.status}.`
    );
  }

  const normalCancellation = await waitForCancelledRun({
    request,
    sleep,
    apiBase,
    staleRun,
    token,
    pollAttempts,
    pollDelayMs,
  });
  if (normalCancellation.cancelled) {
    console.log(
      `Cancelled stale bridge-dispatched Production migration run ${staleRun.id}.`
    );
    return { cancelledRunId: staleRun.id, forced: false };
  }

  if (normalCancellation.lastRun?.status !== 'waiting') {
    safetyStop(
      `stale Production migration run changed to ${normalCancellation.lastRun?.status ?? 'unknown'} before force cancellation.`
    );
  }

  const forceCancelResponse = await request(
    `${apiBase}/actions/runs/${staleRun.id}/force-cancel`,
    token,
    { method: 'POST' }
  );
  if (forceCancelResponse.status !== 202) {
    safetyStop(
      `stale Production migration run force cancellation returned HTTP ${forceCancelResponse.status}.`
    );
  }

  const forcedCancellation = await waitForCancelledRun({
    request,
    sleep,
    apiBase,
    staleRun,
    token,
    pollAttempts,
    pollDelayMs,
  });
  if (forcedCancellation.cancelled) {
    console.log(
      `Force-cancelled stale bridge-dispatched Production migration run ${staleRun.id} after standard cancellation did not complete.`
    );
    return { cancelledRunId: staleRun.id, forced: true };
  }

  safetyStop(
    'stale Production migration run did not reach cancelled state after force cancellation.'
  );
}

export async function cleanupStaleProductionMigrationRun({
  token,
  repository,
  expectedMainSha,
  issueNumber = '165',
  manualWorkflow = 'supabase-production.yml',
}) {
  if (!token) {
    safetyStop('GH_TOKEN is required for stale-run cleanup.');
  }
  if (!/^[^/]+\/[^/]+$/.test(repository ?? '')) {
    safetyStop('GITHUB_REPOSITORY is invalid.');
  }
  if (!/^[0-9]+$/.test(String(issueNumber))) {
    safetyStop('Production Approval Ledger issue number is invalid.');
  }

  const apiBase = `https://api.github.com/repos/${repository}`;
  const runsResponse = await githubRequest(
    `${apiBase}/actions/workflows/${encodeURIComponent(manualWorkflow)}/runs?per_page=100`,
    token
  );
  const runsPayload = await runsResponse.json();
  if (!Array.isArray(runsPayload.workflow_runs)) {
    safetyStop('GitHub workflow-run response is malformed.');
  }
  if ((runsPayload.total_count ?? 0) > 100) {
    safetyStop('Supabase Production workflow run list exceeded the bounded cleanup contract.');
  }

  const commentsResponse = await githubRequest(
    `${apiBase}/issues/${issueNumber}/comments?per_page=100`,
    token
  );
  const ledgerComments = await commentsResponse.json();
  if (!Array.isArray(ledgerComments)) {
    safetyStop('Production Approval Ledger response is malformed.');
  }
  if (ledgerComments.length >= 100) {
    safetyStop('Production Approval Ledger exceeded the bounded comment contract.');
  }

  const staleRun = selectStaleMigrationRunForCleanup({
    runs: runsPayload.workflow_runs,
    ledgerComments,
    expectedMainSha,
    manualWorkflow,
  });

  if (!staleRun) {
    console.log('No stale bridge-dispatched Production migration run requires cleanup.');
    return { cancelledRunId: null };
  }

  return cancelStaleProductionMigrationRun({
    apiBase,
    staleRun,
    token,
  });
}

async function main() {
  await cleanupStaleProductionMigrationRun({
    token: process.env.GH_TOKEN,
    repository: process.env.GITHUB_REPOSITORY,
    expectedMainSha: process.env.EXPECTED_MAIN_SHA,
    issueNumber: process.env.ISSUE_NUMBER ?? '165',
    manualWorkflow: process.env.MANUAL_WORKFLOW ?? 'supabase-production.yml',
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
