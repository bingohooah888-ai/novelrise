import assert from 'node:assert/strict';
import test from 'node:test';
// prettier-ignore
import { inspect020705GithubDualProof } from
  '../.github/staging-ai-02-07-05/github-dual-proof-readonly.mjs';

const NOW = Date.parse('2026-11-01T08:00:00Z');
const SHA = 'a'.repeat(40);
const PREVIEW = 'dpl_synthetic123';
const UID = '11111111-1111-4111-8111-111111111111';
const PREFIX = 'NOVELIGHT_STAGING_AI_020705_PAID_';
// prettier-ignore
const SCOPE = {
  repository: 'bingohooah888-ai/novelrise', issueNumber: 294,
  approvalCommentId: 700, runId: 1001,
  mainSha: SHA, previewDeploymentId: PREVIEW,
  actorId: UID, novelId: 41, episodeId: 11,
  provider: 'openai', model: 'gpt-5.6-luna',
  capMicros: 10000000, consentRevision: 'synthetic-test-v1',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg'
};
// prettier-ignore
function comment(id, kind, data, bot = false) {
  const time = new Date(NOW - 60000 + (id - 700) * 1000).toISOString();
  return {
    id, body: PREFIX + kind + ' ' + JSON.stringify(data),
    created_at: time, updated_at: time,
    user: bot ?
      {login: 'github-actions[bot]', id: 41898282, type: 'Bot'} :
      {login: 'bingohooah888-ai', id: 317436651, type: 'User'},
    author_association: bot ? 'CONTRIBUTOR' : 'OWNER'
  };
}
// prettier-ignore
function fixture({phase = 'claimed', active = false, failUrl = null,
  wrongRunSha = false, changeSecondJobs = false} = {}) {
  const approval = {
    actorId: UID, approvalScope: 'synthetic-one-provider-one-call-only',
    capMicros: 10000000, confirmation: 'STAGING PAID 1 CALL APPROVED',
    consentRevision: SCOPE.consentRevision, episodeId: 11,
    expiresAt: new Date(NOW + 600000).toISOString(), mainSha: SHA,
    model: 'gpt-5.6-luna', novelId: 41, previewDeploymentId: PREVIEW,
    provider: 'openai', stagingProjectRef: SCOPE.stagingProjectRef
  };
  const comments = [comment(700, 'APPROVE', approval)];
  if (phase !== 'unclaimed') comments.push(comment(701, 'CLAIMED', {
    approvalCommentId: 700, mainSha: SHA,
    previewDeploymentId: PREVIEW, runId: 1001
  }, true));
  if (phase === 'consumed') comments.push(comment(702, 'CONSUMED', {
    approvalCommentId: 700, runId: 1001, result: 'cancelled'
  }, true));
  const issue = {
    number: 294, title: '[Staging Control] Supabase migration sync',
    state: 'open', comments: comments.length
  };
  const owner = {login: 'bingohooah888-ai', id: 317436651, type: 'User'};
  const run = {
    id: 1001, repository: {full_name: SCOPE.repository},
    path: '.github/workflows/ai-020705-owner-staging-paid-trial.yml',
    event: 'workflow_dispatch', head_branch: 'main',
    head_sha: wrongRunSha ? 'b'.repeat(40) : SHA,
    run_number: 44, run_attempt: 1, actor: owner,
    triggering_actor: owner,
    created_at: '2026-11-01T07:55:00Z',
    updated_at: '2026-11-01T07:59:00Z',
    status: active ? 'in_progress' : 'completed',
    conclusion: active ? null : 'cancelled'
  };
  const job = {
    id: 2001, run_id: 1001, run_attempt: 1, head_sha: SHA,
    status: active ? 'in_progress' : 'completed',
    conclusion: active ? null : 'cancelled',
    started_at: '2026-11-01T07:56:00Z',
    completed_at: active ? null : '2026-11-01T07:58:00Z'
  };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({url, options});
    if (failUrl && url.includes(failUrl))
      throw new Error('SECRET_FROM_GITHUB_API');
    let value;
    if (url.endsWith('/issues/294')) value = issue;
    else if (url.includes('/issues/294/comments?')) value = comments;
    else if (url.includes('/actions/runs/1001/jobs?')) {
      const count = calls.filter(x =>
        x.url.includes('/actions/runs/1001/jobs?')).length;
      const changed = changeSecondJobs && count > 1
        ? {...job, id: 9999} : job;
      value = {total_count: 1, jobs: [changed]};
    } else if (url.endsWith('/actions/runs/1001')) value = run;
    else throw new Error('UNEXPECTED_URL');
    return {status: 200, json: async () => value};
  };
  return {calls, fetchImpl};
}
// prettier-ignore
async function probe(opts = {}) {
  const {calls, fetchImpl} = fixture(opts);
  const result = await inspect020705GithubDualProof({
    scope: SCOPE, issuesReadToken: 'synthetic-issues-token-123',
    actionsReadToken: 'synthetic-actions-token-456',
    fetchImpl, now: () => NOW
  });
  return {calls, result};
}
// prettier-ignore
test('GitHub CLAIMED and terminal record remain NO-GO without independent evidence', async () => {
  const {calls, result} = await probe();
  assert.equal(result.state, 'GITHUB_TERMINAL_CLAIMED_NEEDS_INDEPENDENT_EVIDENCE');
  assert.equal(result.ledgerState, 'CLAIMED');
  assert.equal(result.independentHeartbeatVerified, false);
  assert.equal(result.stagingCensusVerified, false);
  assert.equal(result.paidProviderAttemptVerified, false);
  assert.equal(result.authorizesMutation, false);
  assert.equal(result.authorizesPaidCall, false);
  assert.equal(result.noPaidRetry, true);
  assert.deepEqual(result.proposedActions, []);
  // Issue GET, twice-scanned comments, Issue recheck, then Actions run/jobs.
  assert.equal(calls.length, 8);
  assert.ok(calls.every(c => c.options.method === 'GET'));
  assert.ok(calls.every(c => c.options.redirect === 'error'));
  assert.ok(calls.every(c => c.url.startsWith('https://api.github.com/repos/bingohooah888-ai/novelrise/')));
  assert.equal(JSON.stringify(result).includes('synthetic-issues-token'), false);
});
// prettier-ignore
test('CONSUMED and terminal record still require independent zero-residue census', async () => {
  const {result} = await probe({phase: 'consumed'});
  assert.equal(result.state, 'GITHUB_TERMINAL_CONSUMED_NEEDS_ZERO_CENSUS');
  assert.deepEqual(result.proposedActions, []);
});
// prettier-ignore
test('active or unclaimed run never becomes cleanup permission', async () => {
  const active = await probe({phase: 'claimed', active: true});
  assert.equal(active.result.state, 'GITHUB_CLAIMED_RUN_NOT_TERMINAL');
  const unclaimed = await probe({phase: 'unclaimed'});
  assert.equal(unclaimed.result.state, 'GITHUB_UNCLAIMED_NO_EXECUTION');
  const conflict = await probe({phase: 'consumed', active: true});
  assert.equal(conflict.result.state, 'GITHUB_CONSUMED_RUN_STILL_ACTIVE_CONFLICT');
});
// prettier-ignore
test('mismatched SHA and a changed second jobs page deny and sanitize errors', async () => {
  for (const opts of [
    {wrongRunSha: true}, {changeSecondJobs: true},
    {failUrl: '/issues/294'}, {failUrl: '/actions/runs/1001'}
  ]) {
    const {fetchImpl} = fixture(opts);
    await assert.rejects(inspect020705GithubDualProof({
      scope: SCOPE, issuesReadToken: 'synthetic-issues-token-123',
      actionsReadToken: 'synthetic-actions-token-456',
      fetchImpl, now: () => NOW
    }), e => e.message === 'AI_020705_GITHUB_DUAL_PROOF_DENIED');
  }
});
// prettier-ignore
test('invalid scopes and missing token do not dispatch any network request', async () => {
  const {calls, fetchImpl} = fixture();
  await assert.rejects(inspect020705GithubDualProof({
    scope: {...SCOPE, runId: -1},
    issuesReadToken: 'synthetic-issues-token-123',
    actionsReadToken: 'synthetic-actions-token-456',
    fetchImpl, now: () => NOW
  }), /AI_020705_GITHUB_DUAL_PROOF_DENIED/u);
  await assert.rejects(inspect020705GithubDualProof({
    scope: SCOPE, issuesReadToken: 'bad',
    actionsReadToken: 'synthetic-actions-token-456',
    fetchImpl, now: () => NOW
  }), /AI_020705_GITHUB_DUAL_PROOF_DENIED/u);
  assert.equal(calls.length, 0);
});
