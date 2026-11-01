import assert from 'node:assert/strict';
import test from 'node:test';
// prettier-ignore
import { inspect020705DetachedSupervisorOffline } from
  '../.github/staging-ai-02-07-05/detached-supervisor-offline-drill.mjs';
const NOW = Date.parse('2026-11-01T08:00:00Z');
const SHA = 'a'.repeat(40);
const UID = '11111111-1111-4111-8111-111111111111';
const PREVIEW = 'dpl_synthetic123';
// prettier-ignore
const scope = {
  repository: 'bingohooah888-ai/novelrise', issueNumber: 294,
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg',
  mainSha: SHA, previewDeploymentId: PREVIEW,
  approvalCommentId: 700, runId: 1001,
  actorId: UID, novelId: 41, episodeId: 11,
  provider: 'openai', model: 'gpt-5.6-luna',
  capMicros: 10000000, consentRevision: 'synthetic-test-v1'
};
// prettier-ignore
function comments() {
  const approval = {
    actorId: UID, approvalScope: 'synthetic-one-provider-one-call-only',
    capMicros: 10000000, confirmation: 'STAGING PAID 1 CALL APPROVED',
    consentRevision: scope.consentRevision, episodeId: 11,
    expiresAt: new Date(NOW + 600000).toISOString(), mainSha: SHA,
    model: 'gpt-5.6-luna', novelId: 41,
    previewDeploymentId: PREVIEW, provider: 'openai',
    stagingProjectRef: scope.stagingProjectRef
  };
  const mk = (id, kind, data, bot = false) => {
    const date = new Date(NOW - 60000 + (id-700)*1000).toISOString();
    return {id,body:'NOVELIGHT_STAGING_AI_020705_PAID_' +
      kind+' '+JSON.stringify(data),
      created_at: date, updated_at: date,
      user: bot ? {login:'github-actions[bot]',id:41898282,type:'Bot'} :
        {login:'bingohooah888-ai',id:317436651,type:'User'},
      author_association: bot?'CONTRIBUTOR':'OWNER'};
  };
  return [mk(700,'APPROVE',approval),mk(701,'CLAIMED',{
    approvalCommentId:700,mainSha:SHA,
    previewDeploymentId:PREVIEW,runId:1001
  },true)];
}
// prettier-ignore
function inputs(opts={}) {
  const c = comments();
  const ledgerSnapshot = {
    repository: scope.repository,
    issue: {number:294,title:'[Staging Control] Supabase migration sync',
      state:'open',comments:c.length},
    commentsCountAfterFetch:c.length,observedAtMs:NOW,
    pages:[{number:1,comments:c}]
  };
  const githubRunnerEvidence={
    repository:scope.repository,runId:1001,mainSha:SHA,
    workflowPath:'.github/workflows/ai-020705-owner-staging-paid-trial.yml',
    runAttempt:1,jobCount:2,status:'completed',conclusion:'cancelled',
    terminalRunnerExitVerified:true,observedAtMs:NOW,
    noPaidRetry:true,authorizesPaidCall:false,authorizesMutation:false,
    independentHeartbeatVerified:false,syntheticScopeVerified:false,
    cleanupVerified:false
  };
  const stagingEvidence={
    projectRef:scope.stagingProjectRef,mainSha:SHA,
    previewDeploymentId:PREVIEW,approvalCommentId:700,runId:1001,
    actorId:UID,novelId:41,episodeId:11,observedAtMs:NOW,
    stagingRuntimeOffZero:false,syntheticCensusZero:false,
    stagingEnvironmentDisabled:false
  };
  const heartbeatEvidence={
    kind:'independent-controller-heartbeat',repository:scope.repository,
    projectRef:scope.stagingProjectRef,mainSha:SHA,
    previewDeploymentId:PREVIEW,approvalCommentId:700,runId:1001,
    actorId:UID,novelId:41,episodeId:11,controllerRunId:3001,
    observedAtMs:NOW,lastHeartbeatAtMs:NOW-180000
  };
  return {
    scope,
    readOwnerLedger:async()=>ledgerSnapshot,
    readGithubRunner:async()=>({...githubRunnerEvidence,...opts.github}),
    readStagingCensus:async()=>stagingEvidence,
    readIndependentHeartbeat:async()=>opts.noHeartbeat?null:heartbeatEvidence,
    now:()=>NOW
  };
}
// prettier-ignore
test('detached dry-run yields advisory only, never mutation capability', async()=>{
  const x=await inspect020705DetachedSupervisorOffline(inputs());
  assert.equal(x.state,'ORPHAN_RECOVERY_ADVISORY_ONLY');
  assert.equal(x.authorizesMutation,false);
  assert.equal(x.authorizesPaidCall,false);
  assert.equal(x.authorizesExecution,false);
  assert.equal(x.noPaidRetry,true);
  assert.equal(x.provenanceAuthenticated,false);
  assert.equal(x.separatelyDeployedWatchdogVerified,false);
  assert.equal(x.requiresSeparateOwnerApproval,true);
});
// prettier-ignore
test('missing detached heartbeat blocks any recovery advice', async()=>{
  const x=await inspect020705DetachedSupervisorOffline(inputs({noHeartbeat:true}));
  assert.equal(x.state,'INDEPENDENT_HEARTBEAT_MISSING');
  assert.deepEqual(x.proposedActions,[]);
});
// prettier-ignore
test('forged run and failed read deny with sanitized error',async()=>{
  await assert.rejects(inspect020705DetachedSupervisorOffline(
    inputs({github:{mainSha:'b'.repeat(40)}})),
    /AI_020705_DETACHED_SUPERVISOR_DRYRUN_DENIED/u);
  const opts=inputs();
  opts.readGithubRunner=async()=>{throw new Error('PRIVATE_TOKEN');};
  await assert.rejects(inspect020705DetachedSupervisorOffline(opts),
    e=>e.message==='AI_020705_DETACHED_SUPERVISOR_DRYRUN_DENIED');
});
