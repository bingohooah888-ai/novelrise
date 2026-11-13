import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATOMIC_PROOF_SCOPE,
  ATOMIC_WRITE_SCOPE,
  APPROVAL_MODES,
  OWNER_LOGIN,
  SOURCE_RPC_SHA256,
  FIXED_CANDIDATE_RPC_SHA256
} from '../scripts/scout-point10x-atomic-staging-plan.mjs';
import {
  STAGING_PROJECT,
  MARKER_SQL_SHA256
} from '../scripts/scout-point10x-atomic-execution-contract.mjs';
import {
  MUTATION_DOMAIN,
  TERMINAL,
  CRASH_BOUNDARIES,
  createScoutPoint10xSymbolicStore,
  modelScoutPoint10xDurableClaim,
  modelScoutPoint10xConsume,
  modelScoutPoint10xReconcile,
  modelScoutPoint10xCrashBoundary,
  exploreScoutPoint10xSymbolicCasRace
} from '../scripts/scout-point10x-durable-fence-model.mjs';

const M = 'a'.repeat(40),
  H = 'b'.repeat(40),
  D = 'c'.repeat(64);
const req = () => ({
  scope: ATOMIC_PROOF_SCOPE,
  mode: APPROVAL_MODES.proof,
  mainSha: M,
  candidateSha: H,
  stagingRef: STAGING_PROJECT,
  operationId: 'point10x-atomic-approved-0001',
  sourceSnapshotSha256: D,
  markerSqlSha256: MARKER_SQL_SHA256,
  legacyRpcSha256: SOURCE_RPC_SHA256,
  candidateRpcSha256: FIXED_CANDIDATE_RPC_SHA256
});
const proof = () => ({
  owner: OWNER_LOGIN,
  issue: 294,
  ownerEventVerified: true,
  trustedMainLoaded: true,
  allIssueHistoryVerified: true,
  exclusiveDomainLockVerified: true,
  candidateDraftVerified: true,
  stagingRefVerified: true,
  freshMainSha: M,
  freshCandidateSha: H,
  stagingSecretsAlreadyRead: false
});
const claim = (change = {}) =>
  modelScoutPoint10xDurableClaim({
    store: createScoutPoint10xSymbolicStore(),
    request: req(),
    requestCommentId: 9001,
    runId: 101,
    expectedVersion: 0,
    expectedEpoch: 0,
    evidence: proof(),
    ...change
  });
const consume = (change = {}) =>
  modelScoutPoint10xConsume({
    store: claim().store,
    request: req(),
    requestCommentId: 9001,
    runId: 101,
    token: 1,
    expectedVersion: 1,
    outcome: 'failure',
    evidence: { githubClaimReReadVerified: true },
    ...change
  });
const recovery = () => ({
  githubConsumedReReadVerified: true,
  durableAuditVerified: true,
  writerFenceStillHeld: true,
  independentRowReconciliation: true,
  cleanupVerified: true,
  commitState: 'not_committed',
  newValidPointAwards: false,
  restoreVerification: 'independent_complete'
});
const reconcile = (change = {}) =>
  modelScoutPoint10xReconcile({
    store: consume().store,
    request: req(),
    requestCommentId: 9001,
    runId: 101,
    token: 1,
    expectedVersion: 2,
    evidence: recovery(),
    ...change
  });
const inert = (r) => {
  assert.equal(r.symbolicOnly, true);
  assert.equal(r.ownerAuthenticatedInReality, false);
  assert.equal(r.durableStoreConnected, false);
  assert.equal(r.compareAndSwapActuallyExecuted, false);
  assert.equal(r.fenceActuallyAcquired, false);
  for (const k of [
    'mayReadStagingSecrets',
    'mayWriteStaging',
    'mayPostGitHubLedger',
    'mayExecuteSql',
    'mayChangeProduction',
    'mayMergeMain',
    'mayDeploy'
  ])
    assert.equal(r[k], false, k);
  assert.ok(Object.isFrozen(r));
};
const blocked = (r, why) => {
  assert.ok(r.blockers.includes(why), r.status + ': ' + why);
  inert(r);
};

test('initial store is inert and scoped to all Point writer mutation', () => {
  const s = createScoutPoint10xSymbolicStore();
  assert.equal(s.domain, MUTATION_DOMAIN);
  assert.equal(s.version, 0);
  assert.equal(s.fencingEpoch, 0);
  assert.equal(s.active, null);
  assert.equal(s.spent.length, 0);
  assert.ok(Object.isFrozen(s));
});
test('symbolic first CAS spends request without GitHub/DB access', () => {
  const r = claim();
  assert.equal(r.status, 'SYMBOLIC_CAS_COMMITTED_NOT_REAL');
  assert.equal(r.store.version, 1);
  assert.equal(r.hypotheticalFencingToken, 1);
  assert.equal(r.store.spent.length, 1);
  assert.equal(r.githubClaimStillUnverified, true);
  inert(r);
});
test('two runners with same initial version cannot both claim', () => {
  const first = claim();
  const second = claim({
    store: first.store,
    runId: 102,
    expectedVersion: 0,
    expectedEpoch: 0
  });
  blocked(second, 'stale_cas_revision_or_fence');
  blocked(second, 'mutation_domain_already_claimed');
});
test('domain stays locked even with newly read version', () => {
  const first = claim();
  blocked(
    claim({
      store: first.store,
      requestCommentId: 9002,
      runId: 102,
      expectedVersion: 1,
      expectedEpoch: 1
    }),
    'mutation_domain_already_claimed'
  );
});
test('CONSUMED plus verified release retains original approval tombstone', () => {
  const finished = reconcile();
  assert.equal(finished.status, 'SYMBOLIC_RELEASE_NOT_REAL');
  assert.equal(finished.store.active, null);
  assert.equal(finished.store.spent.length, 1);
  blocked(
    claim({
      store: finished.store,
      runId: 103,
      expectedVersion: 3,
      expectedEpoch: 1
    }),
    'approval_replay_or_scope_head_reuse'
  );
  inert(finished);
});
test('other comment with same operation ID is refused after release', () => {
  const finished = reconcile();
  blocked(
    claim({
      store: finished.store,
      requestCommentId: 9002,
      runId: 103,
      expectedVersion: 3,
      expectedEpoch: 1
    }),
    'approval_replay_or_scope_head_reuse'
  );
});
test('same scope/HEAD with changed operation ID is refused', () => {
  const finished = reconcile();
  blocked(
    claim({
      store: finished.store,
      request: { ...req(), operationId: 'point10x-atomic-approved-0002' },
      requestCommentId: 9002,
      runId: 103,
      expectedVersion: 3,
      expectedEpoch: 1
    }),
    'approval_replay_or_scope_head_reuse'
  );
});
test('new approval and new HEAD increments fence; stale runner denied', () => {
  const finished = reconcile();
  const newReq = {
    ...req(),
    operationId: 'point10x-atomic-approved-0002',
    candidateSha: 'd'.repeat(40)
  };
  const fresh = claim({
    store: finished.store,
    request: newReq,
    requestCommentId: 9002,
    runId: 103,
    expectedVersion: 3,
    expectedEpoch: 1,
    evidence: { ...proof(), freshCandidateSha: newReq.candidateSha }
  });
  assert.equal(fresh.status, 'SYMBOLIC_CAS_COMMITTED_NOT_REAL');
  assert.equal(fresh.hypotheticalFencingToken, 2);
  blocked(
    modelScoutPoint10xConsume({
      store: fresh.store,
      request: req(),
      requestCommentId: 9001,
      runId: 101,
      token: 1,
      expectedVersion: 4,
      outcome: 'success',
      evidence: { githubClaimReReadVerified: true }
    }),
    'claim_or_fence_token_mismatch'
  );
  inert(fresh);
});
test('distinct atomic scope shares mutation domain but not old approval', () => {
  const r = claim({
    request: {
      ...req(),
      scope: ATOMIC_WRITE_SCOPE,
      mode: APPROVAL_MODES.persist
    }
  });
  assert.equal(r.status, 'SYMBOLIC_CAS_COMMITTED_NOT_REAL');
  assert.equal(r.store.domain, MUTATION_DOMAIN);
  inert(r);
});

const badRequests = [
  ['legacy scope', { scope: 'reader-reward-beta-point-10x-staging' }],
  ['mode mismatch', { scope: ATOMIC_WRITE_SCOPE }],
  ['Production ref', { stagingRef: 'fiepaguycecrredwrcwx' }],
  ['candidate SHA', { candidateSha: 'bad' }],
  ['main SHA', { mainSha: 'bad' }],
  ['source snapshot', { sourceSnapshotSha256: 'bad' }],
  ['marker digest', { markerSqlSha256: 'f'.repeat(64) }],
  ['legacy RPC digest', { legacyRpcSha256: 'f'.repeat(64) }],
  ['candidate RPC digest', { candidateRpcSha256: 'f'.repeat(64) }],
  ['operation ID too short', { operationId: 'x' }],
  ['extra property', { extra: 1 }]
];
for (const [name, change] of badRequests) {
  test('reject tampered request: ' + name, () =>
    blocked(
      claim({ request: { ...req(), ...change } }),
      'invalid_pinned_request'
    )
  );
}
const badProof = [
  ['OWNER spoof', { owner: 'attacker' }],
  ['Issue spoof', { issue: 188 }],
  ['owner event missing', { ownerEventVerified: false }],
  ['trusted main missing', { trustedMainLoaded: false }],
  ['incomplete Issue comment pages', { allIssueHistoryVerified: false }],
  ['missing shared lock', { exclusiveDomainLockVerified: false }],
  ['non-Draft PR', { candidateDraftVerified: false }],
  ['staging ref not verified', { stagingRefVerified: false }]
];
for (const [name, change] of badProof) {
  test('reject self-reported proof: ' + name, () =>
    blocked(
      claim({ evidence: { ...proof(), ...change } }),
      'untrusted_or_incomplete_claim_evidence'
    )
  );
}
test('fresh main drift rejected', () =>
  blocked(
    claim({ evidence: { ...proof(), freshMainSha: 'd'.repeat(40) } }),
    'fresh_main_or_head_mismatch'
  ));
test('fresh candidate HEAD drift rejected', () =>
  blocked(
    claim({ evidence: { ...proof(), freshCandidateSha: 'e'.repeat(40) } }),
    'fresh_main_or_head_mismatch'
  ));
test('secret accessed before CAS is refused', () =>
  blocked(
    claim({ evidence: { ...proof(), stagingSecretsAlreadyRead: true } }),
    'secret_access_before_durable_claim'
  ));
test('invalid comment and run ID cannot be consumed', () => {
  blocked(claim({ requestCommentId: 0 }), 'invalid_comment_or_run');
  blocked(claim({ runId: 0 }), 'invalid_comment_or_run');
});
test('corrupted store fails closed', () =>
  blocked(
    claim({
      store: { ...createScoutPoint10xSymbolicStore(), version: -1 }
    }),
    'invalid_store_snapshot'
  ));
test('stale epoch refused even if version matches', () =>
  blocked(claim({ expectedEpoch: 1 }), 'stale_cas_revision_or_fence'));
test('all test evidence true is still NOT live authority', () =>
  inert(claim()));

test('consume refuses incorrect run or stale fencing token', () => {
  blocked(consume({ runId: 999 }), 'claim_or_fence_token_mismatch');
  blocked(consume({ token: 2 }), 'claim_or_fence_token_mismatch');
});
test('consume needs GitHub CLAIMED re-read and fresh revision', () => {
  blocked(consume({ evidence: {} }), 'github_claim_reread_not_proven');
  blocked(consume({ expectedVersion: 0 }), 'stale_consume_cas_revision');
});
test('all non-uncertain terminal outcomes permanently spend approval', () => {
  for (const outcome of TERMINAL.filter((x) => x !== 'uncertain')) {
    const r = consume({ outcome });
    assert.equal(r.status, 'SYMBOLIC_CONSUMED_NOT_REAL', outcome);
    assert.equal(r.store.active.phase, 'CONSUMED');
    assert.equal(r.store.spent.length, 1);
    inert(r);
  }
});
test('unknown COMMIT needs read-only requery before CONSUMED', () =>
  blocked(
    consume({ outcome: 'uncertain' }),
    'ambiguous_commit_needs_readonly_requery'
  ));
test('uncertain COMMIT remains fenced even after hypothetical requery', () => {
  const c = consume({
    outcome: 'uncertain',
    evidence: {
      githubClaimReReadVerified: true,
      readOnlyCommitRequeryVerified: true
    }
  });
  assert.equal(c.status, 'SYMBOLIC_CONSUMED_NOT_REAL');
  blocked(reconcile({ store: c.store }), 'unknown_commit_must_remain_fenced');
});
test('unsupported terminal value rejected', () =>
  blocked(consume({ outcome: 'auto_retry' }), 'unsupported_terminal_outcome'));
test('duplicate consumption rejected', () => {
  const c = consume();
  blocked(
    modelScoutPoint10xConsume({
      store: c.store,
      request: req(),
      requestCommentId: 9001,
      runId: 101,
      token: 1,
      expectedVersion: 2,
      outcome: 'success',
      evidence: { githubClaimReReadVerified: true }
    }),
    'no_live_claim_to_consume'
  );
});

const badRecovery = [
  [
    'no GitHub consumed re-read',
    { githubConsumedReReadVerified: false },
    'audit_or_recovery_evidence_incomplete'
  ],
  [
    'durable audit missing',
    { durableAuditVerified: false },
    'audit_or_recovery_evidence_incomplete'
  ],
  [
    'writer fence lost',
    { writerFenceStillHeld: false },
    'audit_or_recovery_evidence_incomplete'
  ],
  [
    'all-row reconciliation missing',
    { independentRowReconciliation: false },
    'audit_or_recovery_evidence_incomplete'
  ],
  [
    'cleanup failed',
    { cleanupVerified: false },
    'audit_or_recovery_evidence_incomplete'
  ],
  [
    'commit unknown',
    { commitState: 'unknown' },
    'unknown_commit_must_remain_fenced'
  ],
  [
    'commit ambiguous',
    { commitState: 'ambiguous' },
    'unknown_commit_must_remain_fenced'
  ],
  [
    'commit occurred',
    { commitState: 'committed' },
    'safe_precommit_restore_not_verified'
  ],
  [
    'restore failed',
    { restoreVerification: 'failed' },
    'safe_precommit_restore_not_verified'
  ],
  [
    'new valid points',
    { newValidPointAwards: true },
    'stale_backup_may_erase_valid_points'
  ]
];
for (const [name, change, reason] of badRecovery) {
  test('recovery holds when ' + name, () =>
    blocked(reconcile({ evidence: { ...recovery(), ...change } }), reason)
  );
}
test('CONSUMED alone does not release active domain for another request', () => {
  const c = consume();
  const changeReq = {
    ...req(),
    operationId: 'point10x-atomic-different-0002',
    candidateSha: 'd'.repeat(40)
  };
  blocked(
    claim({
      store: c.store,
      request: changeReq,
      requestCommentId: 9002,
      runId: 102,
      expectedVersion: 2,
      expectedEpoch: 1,
      evidence: { ...proof(), freshCandidateSha: changeReq.candidateSha }
    }),
    'mutation_domain_already_claimed'
  );
});
test('reconcile requires exact identity and fresh revision', () => {
  blocked(
    reconcile({ runId: 102 }),
    'consumed_claim_identity_or_fence_not_proven'
  );
  blocked(
    reconcile({ token: 0 }),
    'consumed_claim_identity_or_fence_not_proven'
  );
  blocked(reconcile({ expectedVersion: 1 }), 'stale_reconciliation_revision');
});
test('all crash boundaries hold and require manual read-only reconciliation', () => {
  for (const boundary of CRASH_BOUNDARIES) {
    const store =
      boundary === 'before_cas_response_unknown'
        ? createScoutPoint10xSymbolicStore()
        : boundary === 'after_consume_ack_lost'
          ? consume().store
          : claim().store;
    const r = modelScoutPoint10xCrashBoundary({ store, boundary });
    assert.equal(r.status, 'CRASH_HOLD_MANUAL_REQUERY');
    assert.equal(r.doNotRetry, true);
    assert.equal(r.doNotReleaseWriterFence, true);
    inert(r);
  }
});
test('missing GitHub CLAIMED cannot erase a durable spent tombstone', () => {
  const r = modelScoutPoint10xCrashBoundary({
    store: claim().store,
    boundary: 'after_cas_before_github_claim'
  });
  assert.equal(r.spentRecordExistsInModel, true);
  inert(r);
});
test('unknown crash boundary cannot authorize retry', () =>
  blocked(
    modelScoutPoint10xCrashBoundary({
      store: claim().store,
      boundary: 'retry_until_success'
    }),
    'invalid_crash_input'
  ));
test('20 exhaustive runner interleavings cannot produce two symbolic CAS wins', () => {
  const r = exploreScoutPoint10xSymbolicCasRace({
    request: req(),
    evidence: proof()
  });
  assert.equal(r.schedules, 20);
  assert.equal(r.doubleAccepted, 0);
  assert.equal(r.schedulesWithRejection, 20);
  assert.equal(r.requiresRealLinearizableStoreAndWriterFence, true);
  inert(r);
});
test('malformed race model request fails closed', () =>
  blocked(
    exploreScoutPoint10xSymbolicCasRace({
      request: { ...req(), candidateSha: 'bad' },
      evidence: proof()
    }),
    'invalid_pinned_request'
  ));
