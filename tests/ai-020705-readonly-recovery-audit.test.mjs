import assert from 'node:assert/strict';
import test from 'node:test';
// prettier-ignore
import { audit020705RecoveryReadOnly } from
  '../.github/staging-ai-02-07-05/read-only-recovery-audit.mjs';

const NOW = Date.parse('2026-11-01T08:00:00Z');
const SHA = 'a'.repeat(40);
const PREVIEW = 'dpl_synthetic123';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const PREFIX = 'NOVELIGHT_STAGING_AI_020705_PAID_';
// prettier-ignore
const SCOPE = {
  repository: 'bingohooah888-ai/novelrise',
  issueNumber: 294, approvalCommentId: 700, runId: 1001,
  mainSha: SHA, previewDeploymentId: PREVIEW,
  actorId: USER_ID, novelId: 41, episodeId: 11,
  provider: 'openai', model: 'gpt-5.6-luna',
  capMicros: 10000000, consentRevision: 'synthetic-test-v1',
  stagingProjectRef: 'wmlzjgvxgoyrovdhbqbg'
};

function comment(id, kind, body, isBot = false) {
  const time = new Date(NOW - 60000 + (id - 700) * 1000).toISOString();
  return {
    id, body: PREFIX + kind + ' ' + JSON.stringify(body),
    created_at: time, updated_at: time,
    user: isBot ?
      {login: 'github-actions[bot]', id: 41898282, type: 'Bot'} :
      {login: 'bingohooah888-ai', id: 317436651, type: 'User'},
    author_association: isBot ? 'CONTRIBUTOR' : 'OWNER'
  };
}
// prettier-ignore
function ledger(phase = 'consumed') {
  const approved = {
    actorId: USER_ID,
    approvalScope: 'synthetic-one-provider-one-call-only',
    capMicros: SCOPE.capMicros,
    confirmation: 'STAGING PAID 1 CALL APPROVED',
    consentRevision: SCOPE.consentRevision,
    episodeId: SCOPE.episodeId,
    expiresAt: new Date(NOW + 600000).toISOString(),
    mainSha: SHA, model: 'gpt-5.6-luna',
    novelId: SCOPE.novelId, previewDeploymentId: PREVIEW,
    provider: 'openai', stagingProjectRef: SCOPE.stagingProjectRef
  };
  const comments = [comment(700, 'APPROVE', approved)];
  if (phase !== 'unclaimed') comments.push(comment(701, 'CLAIMED', {
    approvalCommentId: 700, mainSha: SHA,
    previewDeploymentId: PREVIEW, runId: 1001
  }, true));
  if (phase === 'consumed') comments.push(comment(702, 'CONSUMED', {
    approvalCommentId: 700, runId: 1001, result: 'failure'
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
function stage(overrides = {}) {
  return {
    projectRef: SCOPE.stagingProjectRef, mainSha: SHA,
    previewDeploymentId: PREVIEW, approvalCommentId: 700,
    runId: 1001, novelId: SCOPE.novelId,
    episodeId: SCOPE.episodeId, actorId: USER_ID,
    observedAtMs: NOW, stagingRuntimeOffZero: false,
    syntheticCensusZero: false, stagingEnvironmentDisabled: false,
    ...overrides
  };
}
function audit(phase = 'consumed', overrides = {}) {
  return audit020705RecoveryReadOnly({
    ledgerSnapshot: ledger(phase), scope: SCOPE,
    stagingEvidence: stage(overrides), now: () => NOW
  });
}
function denied(opts) {
  assert.throws(() => audit020705RecoveryReadOnly({
    ledgerSnapshot: opts.ledgerSnapshot ?? ledger('consumed'),
    scope: opts.scope ?? SCOPE,
    stagingEvidence: opts.stagingEvidence ?? stage(),
    now: opts.now ?? (() => NOW)
  }), /AI_020705_RECOVERY_AUDIT_DENIED/u);
}

// prettier-ignore
test('orphaned GitHub CLAIM yields deterministic recovery plan, never paid retry', () => {
  const x = audit('claimed');
  assert.equal(x.ledgerState, 'CLAIMED');
  assert.equal(x.auditState, 'RECOVERY_REQUIRES_SEPARATE_OWNER_APPROVAL');
  assert.equal(x.noPaidRetry, true);
  assert.equal(x.authorizesPaidCall, false);
  assert.equal(x.authorizesMutation, false);
  assert.equal(x.proposedActions.at(-1), 'APPEND_CONSUMED_TOMBSTONE');
});

// prettier-ignore
test('consumed but residual data requires cleanup; never append a second tombstone', () => {
  const x = audit('consumed');
  assert.equal(x.ledgerState, 'CONSUMED');
  assert.equal(x.auditState, 'RECOVERY_REQUIRES_SEPARATE_OWNER_APPROVAL');
  assert.equal(x.proposedActions.includes('APPEND_CONSUMED_TOMBSTONE'), false);
  assert.equal(x.proposedActions.includes('RECHECK_INDEPENDENT_ZERO_CENSUS'), true);
});

// prettier-ignore
test('consumed and independently observed zero residuals produces no-op', () => {
  const x = audit('consumed', {
    stagingRuntimeOffZero: true,
    syntheticCensusZero: true,
    stagingEnvironmentDisabled: true
  });
  assert.equal(x.auditState, 'CONSUMED_AND_CLEANUP_VERIFIED');
  assert.deepEqual(x.proposedActions, []);
});

// prettier-ignore
test('unclaimed GitHub ledger cannot be turned into CLAIMED with forged staging flags', () => {
  const x = audit('unclaimed', {
    claimed: true, consumed: true,
    stagingRuntimeOffZero: true
  });
  assert.equal(x.ledgerState, 'UNCLAIMED');
  assert.equal(x.auditState, 'UNCLAIMED_NO_EXECUTION_AUTHORIZED');
  assert.deepEqual(x.proposedActions, []);
});

// prettier-ignore
test('wrong Staging project, actor, run, Preview or cross-approval scope fail closed', () => {
  for (const change of [
    {projectRef: 'fiepaguycecrredwrcwx'},
    {actorId: '22222222-2222-4222-8222-222222222222'},
    {runId: 1002},
    {previewDeploymentId: 'dpl_other'},
    {approvalCommentId: 701},
    {novelId: 99}
  ]) denied({stagingEvidence: stage(change)});
  denied({scope: {...SCOPE, mainSha: 'b'.repeat(40)}});
});

// prettier-ignore
test('missing ledger page, duplicate CLAIM or conflicting status never yields a plan', () => {
  const missing = ledger('claimed');
  missing.pages = [];
  denied({ledgerSnapshot: missing});
  const duplicate = ledger('claimed');
  const c = duplicate.pages[0].comments.at(-1);
  duplicate.pages[0].comments.push({
    ...c, id: 702, created_at: new Date(NOW - 58000).toISOString(),
    updated_at: new Date(NOW - 58000).toISOString()
  });
  duplicate.issue.comments = 3;
  duplicate.commentsCountAfterFetch = 3;
  denied({ledgerSnapshot: duplicate});
});

// prettier-ignore
test('stale or diverging ledger and census timestamps cannot produce recovery advice', () => {
  denied({stagingEvidence: stage({observedAtMs: NOW - 31000})});
  denied({now: () => NOW + 400000});
  denied({stagingEvidence: stage({observedAtMs: NOW + 1000})});
});

// prettier-ignore
test('no environment token, network operation, or permission is supplied by the audit', () => {
  const x = audit('claimed');
  assert.deepEqual(Object.keys(x).sort(), [
    'auditState', 'authorizesMutation', 'authorizesPaidCall',
    'ledgerState', 'noPaidRetry', 'proposedActions'
  ].sort());
});
