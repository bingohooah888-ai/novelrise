import assert from 'node:assert/strict';
import test from 'node:test';
import { create020705GithubControllerOwnerPortCandidate } from '../.github/staging-ai-02-07-05/gatea-controller-github-owner-port-candidate.mjs';
import inert, { create020705GithubBoundControllerEntryCandidate } from '../.github/staging-ai-02-07-05/gatea-controller-execution-entry-candidate.mjs';

const NOW = Date.parse('2026-11-18T07:00:00Z');
const QUERY = {repository: 'bingohooah888-ai/novelrise',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
  runId: 1001, approvalCommentId: 700};
const SHA = 'a'.repeat(40);
function fixture(tamper = {}) {
  const date = new Date(NOW - 60000).toISOString();
  const approval = {
    actorId: '11111111-1111-4111-8111-111111111111',
    approvalScope: 'synthetic-one-provider-one-call-only',
    capMicros: 1000000, confirmation: 'STAGING PAID 1 CALL APPROVED',
    consentRevision: 'synthetic-test-v1', episodeId: 11,
    expiresAt: new Date(NOW + 600000).toISOString(), mainSha: SHA,
    model: 'gpt-6.1-sol', novelId: 41,
    previewDeploymentId: 'dpl_fixture123', provider: 'openai',
    stagingProjectRef: QUERY.stagingProjectRef,
    approvalIssueNumber: 294, candidateSha: tamper.sha ?? 'b'.repeat(40),
    repository: QUERY.repository, runId: 1001,
    stagingBranch: 'staging/ai-02-07-05-batch'
  };
  const prefix = 'NOVELIGHT_STAGING_AI_020705_PAID_';
  const comments = [
    {id: 700, created_at: date, updated_at: date,
      user: {login: 'bingohooah888-ai', id: 317436651, type: 'User'},
      author_association: 'OWNER',
      body: prefix + 'APPROVE ' + JSON.stringify(approval)},
    {id: 701, created_at: date, updated_at: date,
      user: {login: 'github-actions[bot]',
        id: tamper.bot ? 1 : 41898282, type: 'Bot'},
      body: prefix + 'CLAIMED ' + JSON.stringify({
        approvalCommentId: 700, mainSha: SHA,
        candidateSha: 'b'.repeat(40),
        stagingBranch: 'staging/ai-02-07-05-batch',
        previewDeploymentId: 'dpl_fixture123', runId: 1001
      })}
  ];
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++;
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    if (url.endsWith('/issues/comments/700'))
      return {status: 200, json: async () => comments[0]};
    if (url.endsWith('/issues/294'))
      return {status: 200, json: async () => ({
        number: 294, title: '[Staging Control] Supabase migration sync',
        state: 'open', comments: 2
      })};
    if (url.includes('/issues/294/comments?per_page=100&page=1'))
      return {status: 200, json: async () => comments};
    throw new Error('UNEXPECTED_URL');
  };
  return {fetchImpl, getCalls: () => calls};
}
function source(fetchImpl, attested = true) {
  return create020705GithubControllerOwnerPortCandidate({
    token: 'read-only-fixture-token', controllerRunId: 2002,
    verifyIndependentControllerIdentity: async () => attested,
    fetchImpl, now: () => NOW
  });
}
test('GitHub OWNER approval yields separately scoped recovery and ARM proofs', async () => {
  const {fetchImpl, getCalls} = fixture();
  const port = source(fetchImpl);
  const recovery = await port.readOwnerApprovedScope(QUERY);
  assert.equal(Object.keys(recovery.scope).length, 9);
  assert.equal(recovery.scope.mainSha, SHA);
  assert.equal(await port.verifyOwnerApprovalAttestation(recovery, QUERY), true);
  assert.equal(await port.verifyOwnerApprovalAttestation({...recovery}, QUERY), false);
  const arm = await port.readOwnerApprovedScope({...QUERY, arm: true});
  assert.equal(arm.scope.candidateSha, 'b'.repeat(40));
  assert.equal(arm.scope.capMicros, 1000000);
  assert.equal(await port.verifyOwnerApprovalAttestation(arm,
    {...QUERY, arm: true}), true);
  assert.equal(getCalls(), 10);
});
test('unverified identity, forged SHA and forged bot are rejected', async () => {
  await assert.rejects(source(fixture().fetchImpl, false)
    .readOwnerApprovedScope(QUERY), /CONTROLLER_OWNER_SOURCE_NO_GO/u);
  for (const tamper of [{sha: 'c'.repeat(40)}, {bot: true}]) {
    await assert.rejects(source(fixture(tamper).fetchImpl)
      .readOwnerApprovedScope(QUERY), /CONTROLLER_OWNER_SOURCE_NO_GO/u);
  }
});
test('missing trust, invalid query and default Worker fail closed', async () => {
  assert.throws(() => create020705GithubControllerOwnerPortCandidate(),
    /CONTROLLER_OWNER_SOURCE_NO_GO/u);
  const {fetchImpl, getCalls} = fixture();
  await assert.rejects(source(fetchImpl).readOwnerApprovedScope({
    ...QUERY, approvalCommentId: '700'
  }), /CONTROLLER_OWNER_SOURCE_NO_GO/u);
  assert.equal(getCalls(), 0);
  const entry = create020705GithubBoundControllerEntryCandidate({
    verifyIndependentControllerIdentity: async () => true
  });
  const request = new Request('https://gatea-recovery.internal/_novelight/gatea/recover');
  assert.equal((await entry.fetch(request, {})).status, 404);
  assert.equal((await inert.fetch(request, {
    GATEA_CONTROLLER_LIVE_ENABLED: 'true',
    GATEA_CONTROLLER_RECOVERY_ADMISSION_ENABLED: 'true'
  })).status, 404);
});
