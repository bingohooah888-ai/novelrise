import assert from 'node:assert/strict';
import test from 'node:test';
// prettier-ignore
import { read020705GithubRunnerExit } from
  '../.github/staging-ai-02-07-05/github-runner-exit-readonly.mjs';

const NOW = Date.parse('2026-11-01T09:00:00Z');
const SHA = 'a'.repeat(40);
// prettier-ignore
const SCOPE = {
  repository: 'bingohooah888-ai/novelrise',
  workflowPath: '.github/workflows/ai-020705-owner-staging-paid-trial.yml',
  runId: 1001,
  mainSha: SHA
};

// prettier-ignore
function fixture(opts = {}) {
  const owner = {login: 'bingohooah888-ai', id: 317436651, type: 'User'};
  const run = {
    id: 1001, repository: {full_name: SCOPE.repository},
    path: SCOPE.workflowPath, event: 'workflow_dispatch',
    head_branch: 'main', head_sha: SHA,
    run_number: 55, run_attempt: 1, actor: owner,
    triggering_actor: owner, created_at: '2026-11-01T08:55:00Z',
    updated_at: '2026-11-01T08:58:00Z',
    status: 'completed', conclusion: 'cancelled',
    ...opts.run
  };
  const jobs = [{
    id: 2001, run_id: 1001, run_attempt: 1,
    head_sha: SHA, status: 'completed', conclusion: 'cancelled',
    started_at: '2026-11-01T08:55:10Z',
    completed_at: '2026-11-01T08:56:00Z'
  }, ...(opts.extraJobs ?? [])];
  if (opts.job) Object.assign(jobs[0], opts.job);
  const calls = [];
  const fetchImpl = async (url, request) => {
    calls.push({url, request});
    if (opts.fail) throw new Error('TOKEN_OR_PRIVATE_CONTENT');
    const isJobs = url.includes('/jobs?');
    const n = calls.filter(x => !x.url.includes('/jobs?')).length;
    const response = isJobs ? {total_count: jobs.length, jobs} :
      n > 1 && opts.recheckedRun ? {...run, ...opts.recheckedRun} : run;
    return {status: opts.httpStatus ?? 200, json: async () => response};
  };
  return {run, jobs, calls, fetchImpl};
}

// prettier-ignore
test('GET-only verified terminal workflow run; no paid, cleanup or heartbeat authority', async () => {
  const {calls, fetchImpl} = fixture();
  const result = await read020705GithubRunnerExit({
    token: 'synthetic-only-readable-token', scope: SCOPE,
    fetchImpl, now: () => NOW
  });
  assert.equal(result.terminalRunnerExitVerified, true);
  assert.equal(result.status, 'completed');
  assert.equal(result.conclusion, 'cancelled');
  assert.equal(result.syntheticScopeVerified, false);
  assert.equal(result.independentHeartbeatVerified, false);
  assert.equal(result.cleanupVerified, false);
  assert.equal(result.authorizesPaidCall, false);
  assert.equal(result.authorizesMutation, false);
  assert.equal(result.noPaidRetry, true);
  assert.deepEqual(calls.map(c => c.request.method), ['GET', 'GET', 'GET']);
  assert.ok(calls.every(c => c.request.redirect === 'error'));
  assert.ok(calls.every(c => c.url.startsWith('https://api.github.com/repos/' + SCOPE.repository + '/actions/runs/1001')));
  assert.equal(JSON.stringify(result).includes('synthetic-only-readable-token'), false);
});

// prettier-ignore
test('queued worker is never identified as having exited', async () => {
  const {fetchImpl} = fixture({
    run: {status: 'in_progress', conclusion: null},
    job: {status: 'in_progress', conclusion: null, completed_at: null}
  });
  const result = await read020705GithubRunnerExit({
    token: 'synthetic-only-readable-token', scope: SCOPE,
    fetchImpl, now: () => NOW
  });
  assert.equal(result.terminalRunnerExitVerified, false);
  assert.equal(result.conclusion, null);
});

// prettier-ignore
test('wrong workflow, branch, actor, SHA or rerun attempt fails closed', async () => {
  for (const run of [
    {path: '.github/workflows/ci.yml'},
    {head_branch: 'feature'},
    {event: 'pull_request'},
    {run_attempt: 2},
    {head_sha: 'b'.repeat(40)},
    {actor: {login: 'other', id: 317436651, type: 'User'}},
    {triggering_actor: {login: 'bingohooah888-ai', id: 100, type: 'User'}}
  ]) {
    const {fetchImpl} = fixture({run});
    await assert.rejects(read020705GithubRunnerExit({
      token: 'synthetic-only-readable-token', scope: SCOPE,
      fetchImpl, now: () => NOW
    }), /AI_020705_GITHUB_RUNNER_EXIT_DENIED/u);
  }
});

// prettier-ignore
test('completed run with active or invalid jobs, duplicate job, and inconsistent end fails', async () => {
  const variations = [
    {job: {status: 'in_progress', conclusion: null, completed_at: null}},
    {job: {run_id: 1002}},
    {job: {head_sha: 'b'.repeat(40)}},
    {job: {run_attempt: 2}},
    {extraJobs: [{
      id: 2001, run_id: 1001, run_attempt: 1,
      head_sha: SHA, status: 'completed', conclusion: 'success',
      started_at: '2026-11-01T08:55:20Z',
      completed_at: '2026-11-01T08:56:10Z'
    }]},
    {recheckedRun: {status: 'in_progress', conclusion: null}}
  ];
  for (const options of variations) {
    const {fetchImpl} = fixture(options);
    await assert.rejects(read020705GithubRunnerExit({
      token: 'synthetic-only-readable-token', scope: SCOPE,
      fetchImpl, now: () => NOW
    }), /AI_020705_GITHUB_RUNNER_EXIT_DENIED/u);
  }
});

// prettier-ignore
test('incomplete jobs page, bad credentials and underlying GitHub errors are sanitized', async () => {
  const {fetchImpl} = fixture({fail: true});
  await assert.rejects(read020705GithubRunnerExit({
    token: 'synthetic-only-readable-token', scope: SCOPE,
    fetchImpl, now: () => NOW
  }), e => e.message === 'AI_020705_GITHUB_RUNNER_EXIT_DENIED');

  const {fetchImpl: badResponse} = fixture({httpStatus: 401});
  await assert.rejects(read020705GithubRunnerExit({
    token: 'synthetic-only-readable-token', scope: SCOPE,
    fetchImpl: badResponse, now: () => NOW
  }), /AI_020705_GITHUB_RUNNER_EXIT_DENIED/u);

  const {fetchImpl: okay} = fixture();
  await assert.rejects(read020705GithubRunnerExit({
    token: 'short', scope: SCOPE, fetchImpl: okay, now: () => NOW
  }), /AI_020705_GITHUB_RUNNER_EXIT_DENIED/u);
});

// prettier-ignore
test('missing or invalid scoped SHA/ID never makes a network request', async () => {
  const {calls, fetchImpl} = fixture();
  await assert.rejects(read020705GithubRunnerExit({
    token: 'synthetic-only-readable-token',
    scope: {...SCOPE, runId: 0}, fetchImpl, now: () => NOW
  }), /AI_020705_GITHUB_RUNNER_EXIT_DENIED/u);
  assert.equal(calls.length, 0);
});
