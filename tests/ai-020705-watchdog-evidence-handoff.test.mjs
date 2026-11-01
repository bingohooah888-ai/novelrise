import assert from 'node:assert/strict';
import test from 'node:test';
// prettier-ignore
import { assess020705WatchdogHandoff } from
  '../.github/staging-ai-02-07-05/watchdog-evidence-handoff.mjs';

const NOW = Date.parse('2026-11-01T08:00:00Z');
const SHA = 'a'.repeat(40);
const PREVIEW = 'dpl_synthetic123';
const UID = '11111111-1111-4111-8111-111111111111';
const PREFIX = 'NOVELIGHT_STAGING_AI_020705_PAID_';
// prettier-ignore
const SCOPE = {
  repository: 'bingohooah888-ai/novelrise',
  issueNumber: 294, approvalCommentId: 700, runId: 1001,
  mainSha: SHA, previewDeploymentId: PREVIEW,
  actorId: UID, novelId: 41, episodeId: 11,
  provider: 'openai', model: 'gpt-5.6-luna',
  capMicros: 10000000, consentRevision: 'synthetic-test-v1',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg'
};
// prettier-ignore
function comment(id, kind, data, bot = false) {
  const date = new Date(NOW - 60000 + (id - 700) * 1000).toISOString();
  return {
    id, body: PREFIX + kind + ' ' + JSON.stringify(data),
    created_at: date, updated_at: date,
    user: bot ?
      {login: 'github-actions[bot]', id: 41898282, type: 'Bot'} :
      {login: 'bingohooah888-ai', id: 317436651, type: 'User'},
    author_association: bot ? 'CONTRIBUTOR' : 'OWNER'
  };
}
// prettier-ignore
function ledger(phase = 'claimed') {
  const approval = {
    actorId: UID, approvalScope: 'synthetic-one-provider-one-call-only',
    capMicros: 10000000, confirmation: 'STAGING PAID 1 CALL APPROVED',
    consentRevision: SCOPE.consentRevision, episodeId: 11,
    expiresAt: new Date(NOW + 600000).toISOString(), mainSha: SHA,
    model: 'gpt-5.6-luna', novelId: 41,
    previewDeploymentId: PREVIEW, provider: 'openai',
    stagingProjectRef: SCOPE.stagingProjectRef
  };
  const comments = [comment(700, 'APPROVE', approval)];
  if (phase !== 'unclaimed') comments.push(comment(701, 'CLAIMED', {
    approvalCommentId: 700, mainSha: SHA, previewDeploymentId: PREVIEW,
    runId: 1001
  }, true));
  if (phase === 'consumed') comments.push(comment(702, 'CONSUMED', {
    approvalCommentId: 700, runId: 1001, result: 'cancelled'
  }, true));
  return {
    repository: SCOPE.repository,
    issue: {
      number: 294, title: '[Staging Control] Supabase migration sync',
      state: 'open', comments: comments.length
    },
    commentsCountAfterFetch: comments.length,
    observedAtMs: NOW,
    pages: [{number: 1, comments}]
  };
}
// prettier-ignore
function stage(overrides = {}) {
  return {
    projectRef: SCOPE.stagingProjectRef, mainSha: SHA,
    previewDeploymentId: PREVIEW, approvalCommentId: 700,
    runId: 1001, novelId: 41, episodeId: 11, actorId: UID,
    observedAtMs: NOW, stagingRuntimeOffZero: false,
    syntheticCensusZero: false, stagingEnvironmentDisabled: false,
    ...overrides
  };
}
// prettier-ignore
function github(overrides = {}) {
  return {
    repository: SCOPE.repository,
    runId: 1001, mainSha: SHA,
    workflowPath: '.github/workflows/ai-020705-owner-staging-paid-trial.yml',
    runAttempt: 1, jobCount: 2, status: 'completed',
    conclusion: 'cancelled', terminalRunnerExitVerified: true,
    observedAtMs: NOW, noPaidRetry: true,
    authorizesPaidCall: false, authorizesMutation: false,
    independentHeartbeatVerified: false,
    syntheticScopeVerified: false, cleanupVerified: false,
    ...overrides
  };
}
// prettier-ignore
function heartbeat(overrides = {}) {
  return {
    kind: 'independent-controller-heartbeat',
    repository: SCOPE.repository, projectRef: SCOPE.stagingProjectRef,
    mainSha: SHA, previewDeploymentId: PREVIEW,
    approvalCommentId: 700, runId: 1001,
    actorId: UID, novelId: 41, episodeId: 11,
    controllerRunId: 3001, observedAtMs: NOW,
    lastHeartbeatAtMs: NOW - 180000,
    ...overrides
  };
}
// prettier-ignore
function handoff(phase = 'claimed', githubChanges = {},
  heartbeatValue = heartbeat(), stageValue = stage()) {
  return assess020705WatchdogHandoff({
    scope: SCOPE, ledgerSnapshot: ledger(phase),
    stagingEvidence: stageValue,
    githubRunnerEvidence: github(githubChanges),
    heartbeatEvidence: heartbeatValue,
    now: () => NOW
  });
}
function denied(args) {
  assert.throws(() => assess020705WatchdogHandoff({
    scope: args.scope ?? SCOPE,
    ledgerSnapshot: args.ledgerSnapshot ?? ledger(),
    stagingEvidence: args.stagingEvidence ?? stage(),
    githubRunnerEvidence: args.githubRunnerEvidence ?? github(),
    heartbeatEvidence: args.heartbeatEvidence ?? heartbeat(),
    now: () => NOW
  }), /AI_020705_WATCHDOG_HANDOFF_DENIED/u);
}

// prettier-ignore
test('GitHub terminal alone is insufficient for cleanup: missing independent heartbeat', () => {
  const x = handoff('claimed', {}, null);
  assert.equal(x.status, 'INDEPENDENT_HEARTBEAT_MISSING');
  assert.deepEqual(x.proposedActions, []);
  assert.equal(x.authorizesMutation, false);
  assert.equal(x.authorizesPaidCall, false);
});

// prettier-ignore
test('active GitHub workflow cannot be turned into an orphan by stale heartbeat', () => {
  const x = handoff('claimed', {
    status: 'in_progress', conclusion: null,
    terminalRunnerExitVerified: false
  });
  assert.equal(x.status, 'RUNNER_EXIT_NOT_VERIFIED');
  assert.deepEqual(x.proposedActions, []);
});

// prettier-ignore
test('matching synthetic terminal/heartbeat/ledger is advice only and needs OWNER', () => {
  const x = handoff();
  assert.equal(x.status, 'ORPHAN_RECOVERY_ADVISORY_ONLY');
  assert.equal(x.requiresSeparateOwnerApproval, true);
  assert.equal(x.noPaidRetry, true);
  assert.equal(x.authorizesMutation, false);
  assert.ok(x.proposedActions.includes('APPEND_CONSUMED_TOMBSTONE'));
});

// prettier-ignore
test('consumed ledger with residuals does not require a second tombstone', () => {
  const x = handoff('consumed');
  assert.equal(x.status, 'CONSUMED_RESIDUE_ADVISORY_ONLY');
  assert.equal(x.proposedActions.includes('APPEND_CONSUMED_TOMBSTONE'), false);
});

// prettier-ignore
test('finished cleanup is a no-op; unclaimed is not a recovery grant', () => {
  const zero = handoff('consumed', {}, heartbeat(), stage({
    stagingRuntimeOffZero: true, syntheticCensusZero: true,
    stagingEnvironmentDisabled: true
  }));
  assert.equal(zero.status, 'CLEANUP_ALREADY_VERIFIED');
  assert.deepEqual(zero.proposedActions, []);
  const unclaimed = handoff('unclaimed');
  assert.equal(unclaimed.status, 'NO_APPROVED_ATTEMPT_TO_RECOVER');
  assert.deepEqual(unclaimed.proposedActions, []);
});

// prettier-ignore
test('terminal GitHub report with recent heartbeat never advises cleanup', () => {
  const x = handoff('claimed', {}, heartbeat({
    lastHeartbeatAtMs: NOW - 1000
  }));
  assert.equal(x.status, 'TERMINAL_WORKER_RECHECK_PENDING');
  assert.deepEqual(x.proposedActions, []);
});

// prettier-ignore
test('cross-project, approval, actor, controller and timestamps fail closed', () => {
  for (const bad of [
    {projectRef: 'fiepaguycecrredwrcwx'},
    {runId: 1002},
    {approvalCommentId: 701},
    {actorId: '22222222-2222-4222-8222-222222222222'},
    {controllerRunId: 1001},
    {mainSha: 'b'.repeat(40)},
    {observedAtMs: NOW - 31000},
    {lastHeartbeatAtMs: NOW + 1}
  ]) denied({heartbeatEvidence: heartbeat(bad)});
  denied({githubRunnerEvidence: github({runAttempt: 2})});
  denied({githubRunnerEvidence: github({runId: 9999})});
  denied({githubRunnerEvidence: github({
    syntheticScopeVerified: true
  })});
});

// prettier-ignore
test('forged or incomplete GitHub ledger fails closed despite matching heartbeat', () => {
  const partial = ledger();
  partial.pages = [];
  denied({ledgerSnapshot: partial});
  const changed = ledger();
  changed.pages[0].comments[1].body = PREFIX + 'CLAIMED {}';
  denied({ledgerSnapshot: changed});
});

// prettier-ignore
test('no external action / credential is exposed', () => {
  const x = handoff();
  assert.deepEqual(Object.keys(x).sort(), [
    'authorizesMutation', 'authorizesPaidCall',
    'noPaidRetry', 'proposedActions',
    'requiresSeparateOwnerApproval', 'status'
  ].sort());
});
