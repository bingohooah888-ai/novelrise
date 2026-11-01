import assert from 'node:assert/strict';
import test from 'node:test';
import { inspect020705WatchdogAdmission } from
  '../.github/staging-ai-02-07-05/watchdog-admission-core.mjs';

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
function comment(id, kind, data, isBot = false) {
  const date = new Date(NOW - 60000 + (id - 700) * 1000).toISOString();
  return {
    id, body: PREFIX + kind + ' ' + JSON.stringify(data),
    created_at: date, updated_at: date,
    user: isBot ?
      {login: 'github-actions[bot]', id: 41898282, type: 'Bot'} :
      {login: 'bingohooah888-ai', id: 317436651, type: 'User'},
    author_association: isBot ? 'CONTRIBUTOR' : 'OWNER'
  };
}
// prettier-ignore
function ledger(phase = 'claimed') {
  const approval = {
    actorId: UID, approvalScope: 'synthetic-one-provider-one-call-only',
    capMicros: 10000000, confirmation: 'STAGING PAID 1 CALL APPROVED',
    consentRevision: SCOPE.consentRevision, episodeId: 11,
    expiresAt: new Date(NOW + 600000).toISOString(),
    mainSha: SHA, model: 'gpt-5.6-luna', novelId: 41,
    previewDeploymentId: PREVIEW, provider: 'openai',
    stagingProjectRef: SCOPE.stagingProjectRef
  };
  const comments = [comment(700, 'APPROVE', approval)];
  if (phase !== 'unclaimed') comments.push(comment(701, 'CLAIMED', {
    approvalCommentId: 700, mainSha: SHA,
    previewDeploymentId: PREVIEW, runId: 1001
  }, true));
  if (phase === 'consumed') comments.push(comment(702, 'CONSUMED', {
    approvalCommentId: 700, runId: 1001, result: 'cancelled'
  }, true));
  return {
    repository: SCOPE.repository,
    issue: {number: 294, title: '[Staging Control] Supabase migration sync',
      state: 'open', comments: comments.length},
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
function runner(overrides = {}) {
  return {
    repository: SCOPE.repository,
    projectRef: SCOPE.stagingProjectRef,
    mainSha: SHA, previewDeploymentId: PREVIEW,
    approvalCommentId: 700, runId: 1001, actorId: UID,
    novelId: 41, episodeId: 11, readOnlySnapshotVerified: true,
    runAttempt: 1, observedAtMs: NOW,
    lastHeartbeatAtMs: NOW - 180000,
    status: 'completed', conclusion: 'cancelled',
    ...overrides
  };
}
// prettier-ignore
function inspect(phase = 'claimed', stageChanges = {}, runnerChanges = {}) {
  return inspect020705WatchdogAdmission({
    scope: SCOPE, ledgerSnapshot: ledger(phase),
    stagingEvidence: stage(stageChanges),
    runnerEvidence: runner(runnerChanges),
    now: () => NOW
  });
}
// prettier-ignore
function denied({phase = 'claimed', s = SCOPE, l, st, r, clock} = {}) {
  assert.throws(() => inspect020705WatchdogAdmission({
    scope: s,
    ledgerSnapshot: l ?? ledger(phase),
    stagingEvidence: st ?? stage(),
    runnerEvidence: r ?? runner(),
    now: clock ?? (() => NOW)
  }), /AI_020705_WATCHDOG_ADMISSION_DENIED/u);
}

// prettier-ignore
test('verified cancelled and stale CLAIM returns advisory, not mutation or retry', () => {
  const x = inspect();
  assert.equal(x.watchdogState, 'ORPHAN_RECOVERY_ADVISORY_ONLY');
  assert.equal(x.ledgerState, 'CLAIMED');
  assert.equal(x.proposedActions.at(-1), 'APPEND_CONSUMED_TOMBSTONE');
  assert.equal(x.noPaidRetry, true);
  assert.equal(x.authorizesPaidCall, false);
  assert.equal(x.authorizesMutation, false);
});

// prettier-ignore
test('fresh and stale in-progress runner never recommends cleanup', () => {
  const active = inspect('claimed', {}, {
    status: 'in_progress', conclusion: null, lastHeartbeatAtMs: NOW - 1000
  });
  assert.equal(active.watchdogState, 'WORKER_ACTIVE_NO_STOP');
  assert.deepEqual(active.proposedActions, []);
  const stale = inspect('claimed', {}, {
    status: 'in_progress', conclusion: null, lastHeartbeatAtMs: NOW - 200000
  });
  assert.equal(stale.watchdogState, 'STALE_WORKER_REQUIRES_INDEPENDENT_EXIT_PROOF');
  assert.deepEqual(stale.proposedActions, []);
});

// prettier-ignore
test('terminal runner with recent heartbeat requires recheck before advice', () => {
  const x = inspect('claimed', {}, {lastHeartbeatAtMs: NOW - 5000});
  assert.equal(x.watchdogState, 'TERMINAL_WORKER_RECHECK_PENDING');
  assert.deepEqual(x.proposedActions, []);
});

// prettier-ignore
test('CONSUMED with residue never generates a second consumed marker', () => {
  const x = inspect('consumed');
  assert.equal(x.watchdogState, 'CONSUMED_RESIDUE_ADVISORY_ONLY');
  assert.equal(x.ledgerState, 'CONSUMED');
  assert.ok(x.proposedActions.includes('RECHECK_INDEPENDENT_ZERO_CENSUS'));
  assert.equal(x.proposedActions.includes('APPEND_CONSUMED_TOMBSTONE'), false);
});

// prettier-ignore
test('independent zero cleanup has no further actions', () => {
  const x = inspect('consumed', {
    stagingRuntimeOffZero: true,
    syntheticCensusZero: true, stagingEnvironmentDisabled: true
  });
  assert.equal(x.watchdogState, 'CLEANUP_ALREADY_VERIFIED');
  assert.deepEqual(x.proposedActions, []);
});

// prettier-ignore
test('unclaimed approval never authorizes cleanup even if runner is cancelled', () => {
  const x = inspect('unclaimed');
  assert.equal(x.watchdogState, 'NO_APPROVED_ATTEMPT_TO_RECOVER');
  assert.deepEqual(x.proposedActions, []);
});

// prettier-ignore
test('cross-project, actor, SHA, run and Preview snapshots fail closed', () => {
  for (const changes of [
    {projectRef: 'fiepaguycecrredwrcwx'},
    {actorId: '22222222-2222-4222-8222-222222222222'},
    {mainSha: 'b'.repeat(40)},
    {runId: 2000},
    {previewDeploymentId: 'dpl_other'},
    {runAttempt: 2},
    {readOnlySnapshotVerified: false}
  ]) denied({r: runner(changes)});
  denied({s: {...SCOPE, projectRef: 'fiepaguycecrredwrcwx'}});
});

// prettier-ignore
test('unknown, contradictory, stale or future runner evidence fail closed', () => {
  for (const changes of [
    {status: 'stuck'},
    {status: 'completed', conclusion: null},
    {status: 'queued', conclusion: 'success'},
    {status: 'in_progress', conclusion: 'cancelled'},
    {status: 'completed', conclusion: 'unknown'},
    {observedAtMs: NOW - 31000},
    {observedAtMs: NOW + 1000},
    {lastHeartbeatAtMs: NOW + 1000}
  ]) denied({r: runner(changes)});
  denied({clock: () => NOW + 400000});
});

// prettier-ignore
test('missing authenticated GitHub approval and census fails without advice', () => {
  const bad = ledger();
  bad.pages = [];
  denied({l: bad});
  denied({st: stage({observedAtMs: NOW - 100000})});
  const other = ledger();
  other.pages[0].comments[1].body = PREFIX + 'CLAIMED {}';
  denied({l: other});
});

// prettier-ignore
test('decision-only output contains no usable credential, executor or callback', () => {
  const x = inspect();
  assert.deepEqual(Object.keys(x).sort(), [
    'authorizesMutation', 'authorizesPaidCall', 'ledgerState',
    'noPaidRetry', 'proposedActions', 'recoveryState', 'watchdogState'
  ].sort());
  assert.equal(JSON.stringify(x).includes('Authorization'), false);
});
