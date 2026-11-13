import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
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
  PRODUCTION_PROJECT,
  MARKER_SQL_SHA256
} from '../scripts/scout-point10x-atomic-execution-contract.mjs';
import { MUTATION_DOMAIN } from '../scripts/scout-point10x-durable-fence-model.mjs';
import {
  RECOVERY_WRITER_CLASSES,
  RECOVERY_RELATIONS
} from '../scripts/scout-point10x-recovery-drain-model.mjs';
import { REQUIRED_PRIVILEGED_PATHS } from '../scripts/scout-point10x-cas-fencing-handoff-model.mjs';
import {
  CROSS_DB_CRASH_WINDOWS,
  CROSS_DB_EVENTS,
  createCrossDbOfflineReviewState,
  stepCrossDbOfflineReview,
  reviewAllCrossDbCrashWindows,
  auditGuardedReviewSql
} from '../scripts/scout-point10x-cross-db-recovery-review.mjs';

const MAIN = 'a'.repeat(40),
  HEAD = 'b'.repeat(40),
  DIGEST = 'c'.repeat(64);
const request = () => ({
  scope: ATOMIC_PROOF_SCOPE,
  mode: APPROVAL_MODES.proof,
  mainSha: MAIN,
  candidateSha: HEAD,
  stagingRef: STAGING_PROJECT,
  operationId: 'cross-db-atomic-0001',
  sourceSnapshotSha256: DIGEST,
  markerSqlSha256: MARKER_SQL_SHA256,
  legacyRpcSha256: SOURCE_RPC_SHA256,
  candidateRpcSha256: FIXED_CANDIDATE_RPC_SHA256
});
const ownerFixture = () => ({
  authenticatedByTrustedMainInFixture: true,
  owner: OWNER_LOGIN,
  issueNumber: 294,
  issueTitle: '[Staging Control] Supabase migration sync',
  ownerEventIsFreshInFixture: true,
  issueHistoryCompleteInFixture: true,
  mainSha: MAIN,
  candidateSha: HEAD,
  dedicatedStagingRef: STAGING_PROJECT,
  primaryCasMayCommitInFixture: true,
  secretsRead: false,
  sharedDomainUncontendedInFixture: true
});
const writerEvidence = (epoch = 1) =>
  RECOVERY_WRITER_CLASSES.map((kind) => ({
    kind,
    paused: true,
    admissionClosed: true,
    dataPlaneEpoch: epoch,
    oldTokenRejected: true,
    active: 0,
    inflight: 0,
    queued: 0,
    retry: 0,
    unacked: 0,
    outbox: 0
  }));
const privilegedEvidence = () =>
  REQUIRED_PRIVILEGED_PATHS.map((path) => ({
    path,
    dbEnforced: true,
    bypassImpossible: true,
    oldEpochRejected: true
  }));
const prepEvidence = () => ({
  immutableFullBackup: true,
  independentlyRestoredIntoIsolatedPostgres: true,
  allFiveRelationDigestsMatched: true,
  catalogRpcAclTriggerMatched: true,
  pointXpAndReversalsConserved: true,
  noPostSnapshotAwardOrOutboxChanges: true,
  doubleReadOnlySampleStable: true,
  allNineWritersHeldClosed: true,
  privilegedPathsCannotBypass: true,
  noOwnerOrSuperuserDdlBypass: true,
  oneStageTransactionReviewed: true,
  privateMarkerAndExactRpcPinned: true,
  controlPrimarySpentAndStillExclusive: true,
  projectIdentityChecked: true,
  noSessionGucAsTrustedToken: true,
  sourceDigest: DIGEST,
  epoch: 1,
  relations: [...RECOVERY_RELATIONS],
  privilegedPaths: [...REQUIRED_PRIVILEGED_PATHS]
});
const readback = (kind = 'committed') => ({
  controlSpent: true,
  controlEpoch: 1,
  stagingEpoch: 1,
  dbWriterFenceStillHeld: true,
  readOnlySamples: 2,
  fullRowDigestAndSequenceMatched: true,
  xpPointReversalsConserved: true,
  externalSideEffectsConserved: true,
  functionAclRlsTriggerParity: true,
  marker: kind === 'committed' ? 'PRESENT' : 'ABSENT',
  unit: kind === 'committed' ? '10pt_per_yen' : '1pt_per_yen',
  rpcAward: kind === 'committed' ? 50 : 5
});
const go = (state, event) => stepCrossDbOfflineReview({ state, event });
const claimEvent = () => ({
  type: 'CLAIM',
  request: request(),
  ownerFixture: ownerFixture(),
  commentId: 9011,
  runId: 2001,
  expectedVersion: 0,
  expectedEpoch: 0
});
const fenceEvent = () => ({
  type: 'FENCE',
  runId: 2001,
  epoch: 1,
  writerEvidence: writerEvidence(),
  privilegedEvidence: privilegedEvidence()
});
const claim = () => go(createCrossDbOfflineReviewState(), claimEvent());
const fence = () => go(claim().state, fenceEvent());
const prepare = () =>
  go(fence().state, { type: 'PREPARE', evidence: prepEvidence() });
const commit = (outcome = 'committed') =>
  go(prepare().state, { type: 'STAGE_COMMIT', outcome });
function assertNoAuthority(x) {
  assert.equal(x.provenance, 'offline_untrusted_fixture');
  assert.equal(x.distributedCommitProven, false);
  for (const key of [
    'realOwnerAuthenticated',
    'realSpentLedgerUpdated',
    'realDataPlaneFenced',
    'realBackupRestored',
    'realCutoverCommitted',
    'realReconciliationPerformed',
    'mayReadSecrets',
    'mayQueryDb',
    'mayRunSql',
    'mayWriteDb',
    'mayRunStaging',
    'mayPostApprovalOrClaim',
    'mayResumeWriters',
    'mayReleaseDomain',
    'mayMergeMain',
    'mayDeploy',
    'mayModifyProduction'
  ])
    assert.equal(x[key], false, key);
  assert.ok(Object.isFrozen(x));
  assert.ok(Object.isFrozen(x.blockers));
  if (x.state) assert.ok(Object.isFrozen(x.state));
}
const blocked = (out, reason) => {
  assert.ok(
    out.blockers.includes(reason),
    out.status + ' missing ' + reason + ' got ' + out.blockers.join(',')
  );
  assertNoAuthority(out);
};
test('new state has separate immutable control/stage and stable mutation domain', () => {
  const s = createCrossDbOfflineReviewState();
  assert.equal(s.domain, MUTATION_DOMAIN);
  assert.equal(s.control.domain, MUTATION_DOMAIN);
  assert.equal(s.control.version, 0);
  assert.equal(s.stage.project, STAGING_PROJECT);
  assert.equal(s.stage.phase, 'UNFENCED');
  assert.equal(s.stage.rpcAward, 5);
  assert.equal(s.stage.marker, 'ABSENT');
  assert.ok(Object.isFrozen(s));
  assert.ok(Object.isFrozen(s.stage));
});
test('contract is exactly eleven reviewed cross-DB crash windows', () => {
  assert.equal(CROSS_DB_CRASH_WINDOWS.length, 11);
  assert.equal(new Set(CROSS_DB_CRASH_WINDOWS).size, 11);
  assert.equal(CROSS_DB_EVENTS.length, 9);
  assert.ok(Object.isFrozen(CROSS_DB_CRASH_WINDOWS));
});
test('PRIMARY spent is distinct from and earlier than Staging fence', () => {
  const r = claim();
  assert.equal(r.status, 'MODEL_PRIMARY_CAS_COMMITTED_STAGE_UNFENCED');
  assert.equal(r.state.control.spent.length, 1);
  assert.equal(r.state.control.epoch, 1);
  assert.equal(r.state.stage.phase, 'PRIMARY_SPENT_UNFENCED');
  assert.equal(r.state.stage.localEpoch, null);
  assert.equal(r.discreteDbRiskWindow, true);
  assertNoAuthority(r);
});
test('original immutable state is unchanged after a proposed claim', () => {
  const s = createCrossDbOfflineReviewState();
  const r = go(s, claimEvent());
  assert.equal(s.control.spent.length, 0);
  assert.equal(s.stage.phase, 'UNFENCED');
  assert.equal(r.state.control.spent.length, 1);
  assertNoAuthority(r);
});
test('CAS cannot consume same request twice', () => {
  blocked(go(claim().state, claimEvent()), 'domain_already_claimed');
});
test('same main/head but new run cannot bypass consumed domain', () => {
  blocked(
    go(claim().state, { ...claimEvent(), runId: 3002 }),
    'domain_already_claimed'
  );
});
test('old rollback-only scope rejected', () => {
  const event = claimEvent();
  event.request.scope = 'reader-reward-beta-point-10x-staging';
  blocked(
    go(createCrossDbOfflineReviewState(), event),
    'invalid_or_replayed_scope_request'
  );
});
test('Production ref rejected', () => {
  const event = claimEvent();
  event.request.stagingRef = PRODUCTION_PROJECT;
  blocked(
    go(createCrossDbOfflineReviewState(), event),
    'invalid_or_replayed_scope_request'
  );
});
test('different approved HEAD requires new owner event', () => {
  const event = claimEvent();
  event.request.candidateSha = 'd'.repeat(40);
  blocked(
    go(createCrossDbOfflineReviewState(), event),
    'not_authenticated_real_owner_evidence'
  );
});
test('atomic persist scope requires distinct mode and OWNER data', () => {
  const event = claimEvent();
  event.request.scope = ATOMIC_WRITE_SCOPE;
  event.request.mode = APPROVAL_MODES.persist;
  event.ownerFixture.scope = ATOMIC_WRITE_SCOPE;
  const r = go(createCrossDbOfflineReviewState(), event);
  assert.equal(r.status, 'MODEL_PRIMARY_CAS_COMMITTED_STAGE_UNFENCED');
  assertNoAuthority(r);
});
test('no owner evidence fails primary claim', () => {
  blocked(
    go(createCrossDbOfflineReviewState(), {
      ...claimEvent(),
      ownerFixture: null
    }),
    'not_authenticated_real_owner_evidence'
  );
});
test('wrong CAS expected version fails', () => {
  blocked(
    go(createCrossDbOfflineReviewState(), {
      ...claimEvent(),
      expectedVersion: 1
    }),
    'stale_version_or_epoch'
  );
});
test('unreviewed event denied', () => {
  blocked(
    go(createCrossDbOfflineReviewState(), { type: 'SECRET_WRITE' }),
    'unknown_transition'
  );
});
test('bad state denied safely', () => {
  blocked(go({ domain: 'other' }, claimEvent()), 'invalid_state');
});
test('stage fence can only be acquired after model primary CAS', () => {
  blocked(
    go(createCrossDbOfflineReviewState(), fenceEvent()),
    'primary_spent_not_confirmed'
  );
});
test('fence passes only with complete 9 Writer and 5 privileged assertions', () => {
  const r = fence();
  assert.equal(r.status, 'MODEL_DB_FENCE_NOT_ACTUAL');
  assert.equal(r.state.stage.phase, 'FENCED');
  assert.equal(r.state.stage.localEpoch, 1);
  assert.equal(r.state.control.spent.length, 1);
  assertNoAuthority(r);
});
test('fence on old epoch is rejected', () => {
  const a = fenceEvent();
  a.epoch = 0;
  blocked(go(claim().state, a), 'claim_or_epoch_mismatch');
});
test('fence on another run denied', () => {
  const a = fenceEvent();
  a.runId = 9999;
  blocked(go(claim().state, a), 'claim_or_epoch_mismatch');
});
test('one absent writer blocks even if eight comply', () => {
  const a = fenceEvent();
  a.writerEvidence.pop();
  blocked(go(claim().state, a), 'incomplete_writer_inventory');
});
test('one unverified privileged path blocks', () => {
  const a = fenceEvent();
  a.privilegedEvidence.pop();
  blocked(go(claim().state, a), 'privileged_writer_path_inventory_incomplete');
});
for (const kind of RECOVERY_WRITER_CLASSES) {
  test('paused but inflight writer blocks Data Plane freeze: ' + kind, () => {
    const a = fenceEvent();
    a.writerEvidence.find((x) => x.kind === kind).inflight = 1;
    blocked(go(claim().state, a), 'not_drained_or_fenced:' + kind);
  });
}
for (const path of REQUIRED_PRIVILEGED_PATHS) {
  test('SECDEF/service_role/privileged bypass blocks: ' + path, () => {
    const a = fenceEvent();
    a.privilegedEvidence.find((x) => x.path === path).bypassImpossible = false;
    blocked(go(claim().state, a), 'privileged_path_unfenced:' + path);
  });
}
test('backup cannot run before fence', () => {
  blocked(
    go(claim().state, { type: 'PREPARE', evidence: prepEvidence() }),
    'continuous_db_fence_unverified'
  );
});
test('verified fixture produces only synthetic prepare', () => {
  const r = prepare();
  assert.equal(r.status, 'MODEL_PREPARED_ONLY');
  assert.equal(r.state.stage.phase, 'PREPARED');
  assert.equal(r.state.stage.backupRestoreConfirmed, true);
  assert.equal(r.state.stage.originalDigest, DIGEST);
  assertNoAuthority(r);
});
const preparationFlags = [
  'immutableFullBackup',
  'independentlyRestoredIntoIsolatedPostgres',
  'allFiveRelationDigestsMatched',
  'catalogRpcAclTriggerMatched',
  'pointXpAndReversalsConserved',
  'noPostSnapshotAwardOrOutboxChanges',
  'doubleReadOnlySampleStable',
  'allNineWritersHeldClosed',
  'privilegedPathsCannotBypass',
  'noOwnerOrSuperuserDdlBypass',
  'oneStageTransactionReviewed',
  'privateMarkerAndExactRpcPinned',
  'controlPrimarySpentAndStillExclusive',
  'projectIdentityChecked',
  'noSessionGucAsTrustedToken'
];
for (const field of preparationFlags) {
  test('frozen Staging cannot proceed without ' + field, () => {
    const evidence = prepEvidence();
    evidence[field] = false;
    blocked(
      go(fence().state, { type: 'PREPARE', evidence }),
      'preparation_unproven:' + field
    );
  });
}
test('stale PRIMARY epoch cannot be consumed by Staging prepare', () => {
  const evidence = prepEvidence();
  evidence.epoch = 2;
  blocked(
    go(fence().state, { type: 'PREPARE', evidence }),
    'cross_db_epoch_mismatch'
  );
});
test('unknown source digest rejected', () => {
  const evidence = prepEvidence();
  evidence.sourceDigest = 'junk';
  blocked(
    go(fence().state, { type: 'PREPARE', evidence }),
    'source_digest_invalid'
  );
});
test('unknown Point/XP relation rejected', () => {
  const evidence = prepEvidence();
  evidence.relations[0] = 'unknown';
  blocked(
    go(fence().state, { type: 'PREPARE', evidence }),
    'five_relation_inventory_incomplete'
  );
});
test('extra privileged call path cannot be silently skipped', () => {
  const evidence = prepEvidence();
  evidence.privilegedPaths.push('other');
  blocked(
    go(fence().state, { type: 'PREPARE', evidence }),
    'privileged_path_inventory_incomplete'
  );
});
test('Staging transaction not attempted without prepare', () => {
  blocked(
    go(fence().state, { type: 'STAGE_COMMIT', outcome: 'committed' }),
    'no_fenced_verified_preparation'
  );
});
test('symbolic COMMIT changes marker, rpc, unit together, but never DB', () => {
  const r = commit();
  assert.equal(r.status, 'MODEL_COMMIT_ASSERTION_NO_LIVE_PROOF');
  assert.equal(r.state.stage.phase, 'COMMIT_ASSERTED');
  assert.equal(r.state.stage.rpcAward, 50);
  assert.equal(r.state.stage.unit, '10pt_per_yen');
  assert.equal(r.state.stage.marker, 'PRESENT');
  assert.equal(r.state.control.spent.length, 1);
  assertNoAuthority(r);
});
test('symbolic rollback preserves spent tombstone', () => {
  const r = commit('rolled_back');
  assert.equal(r.status, 'MODEL_ROLLBACK_ASSERTION_NO_LIVE_PROOF');
  assert.equal(r.state.stage.rpcAward, 5);
  assert.equal(r.state.stage.marker, 'ABSENT');
  assert.equal(r.state.control.spent.length, 1);
  assert.equal(r.spentTombstoneMustRemain, true);
  assertNoAuthority(r);
});
for (const outcome of ['unknown', 'timeout']) {
  test(
    'commit ack lost => unit is unknown, all actions frozen: ' + outcome,
    () => {
      const r = commit(outcome);
      assert.equal(r.status, 'HOLD_COMMIT_ACK_UNKNOWN');
      assert.equal(r.state.stage.phase, 'COMMIT_UNKNOWN');
      assert.equal(r.state.stage.marker, 'UNKNOWN');
      assert.equal(r.state.stage.rpcAward, 'UNKNOWN');
      assert.equal(r.state.stage.unit, 'UNKNOWN');
      assert.equal(r.noAutomaticReplayOrRestore, true);
      assertNoAuthority(r);
    }
  );
}
test('invalid COMMIT response cannot change model state', () => {
  const s = prepare().state;
  const r = go(s, { type: 'STAGE_COMMIT', outcome: 'retry' });
  blocked(r, 'invalid_commit_response');
  assert.equal(r.state, s);
});
test('commit cannot skip read-only reconciliation', () => {
  blocked(
    go(commit().state, { type: 'RESUME' }),
    'offline_model_cannot_resume_or_release_writer_domain'
  );
});
test('read-only reconciliation cannot run before COMMIT', () => {
  blocked(
    go(prepare().state, {
      type: 'RECONCILE',
      readback: readback()
    }),
    'commit_outcome_not_pending'
  );
});
test('consistent commit readback still does not authorize any writer', () => {
  const r = go(commit().state, { type: 'RECONCILE', readback: readback() });
  assert.equal(r.status, 'MODEL_COMMIT_READBACK_ONLY');
  assert.equal(r.state.stage.phase, 'REVIEW_COMMITTED');
  assert.equal(r.approvalRemainsSpent, true);
  assert.equal(r.resumeRequiresNewOwnerGate, true);
  assertNoAuthority(r);
});
test('consistent rollback readback still cannot reuse spent approval', () => {
  const r = go(commit('rolled_back').state, {
    type: 'RECONCILE',
    readback: readback('rolled_back')
  });
  assert.equal(r.status, 'MODEL_ROLLBACK_READBACK_ONLY');
  assert.equal(r.state.stage.phase, 'REVIEW_ROLLED_BACK');
  assert.equal(r.approvalRemainsSpent, true);
  assertNoAuthority(r);
});
test('COMMIT unknown can only classify through matching readback', () => {
  const state = commit('unknown').state;
  for (const kind of ['committed', 'rolled_back']) {
    const r = go(state, { type: 'RECONCILE', readback: readback(kind) });
    assert.ok(r.status.includes('READBACK_ONLY'));
    assert.equal(r.state.control.spent.length, 1);
    assertNoAuthority(r);
  }
});
test('mixed RPC/marker/unit readback is manual HOLD', () => {
  const e = readback();
  e.rpcAward = 5;
  blocked(
    go(commit('unknown').state, { type: 'RECONCILE', readback: e }),
    'mixed_marker_rpc_unit'
  );
});
test('asserted COMMIT contradicting readback is manual HOLD', () => {
  blocked(
    go(commit().state, {
      type: 'RECONCILE',
      readback: readback('rolled_back')
    }),
    'commit_ack_contradicts_database'
  );
});
test('asserted rollback contradicting readback is manual HOLD', () => {
  blocked(
    go(commit('rolled_back').state, {
      type: 'RECONCILE',
      readback: readback('committed')
    }),
    'rollback_ack_contradicts_database'
  );
});
test('no independent PRIMARY spent proof blocks reconciliation', () => {
  const e = readback();
  e.controlSpent = false;
  blocked(
    go(commit('unknown').state, { type: 'RECONCILE', readback: e }),
    'control_spent_or_stage_epoch_mismatch'
  );
});
test('stale stage fencing epoch blocks reconciliation', () => {
  const e = readback();
  e.stagingEpoch = 0;
  blocked(
    go(commit('unknown').state, { type: 'RECONCILE', readback: e }),
    'control_spent_or_stage_epoch_mismatch'
  );
});
test('released Writer fence blocks reconciliation', () => {
  const e = readback();
  e.dbWriterFenceStillHeld = false;
  blocked(
    go(commit('unknown').state, { type: 'RECONCILE', readback: e }),
    'control_spent_or_stage_epoch_mismatch'
  );
});
for (const field of [
  'fullRowDigestAndSequenceMatched',
  'xpPointReversalsConserved',
  'externalSideEffectsConserved',
  'functionAclRlsTriggerParity'
]) {
  test('postcommit cannot skip ' + field, () => {
    const e = readback();
    e[field] = false;
    blocked(
      go(commit('unknown').state, { type: 'RECONCILE', readback: e }),
      'postcommit_integrity_unproven'
    );
  });
}
test('one read-only sample cannot certify recovered state', () => {
  const e = readback();
  e.readOnlySamples = 1;
  blocked(
    go(commit('unknown').state, { type: 'RECONCILE', readback: e }),
    'postcommit_integrity_unproven'
  );
});
test('missing reconciliation evidence never throws', () => {
  blocked(
    go(commit('unknown').state, { type: 'RECONCILE' }),
    'read_only_primary_and_staging_evidence_missing'
  );
});
for (const window of CROSS_DB_CRASH_WINDOWS) {
  test('crash window stays manual-only: ' + window, () => {
    const state = window.includes('stage') ? fence().state : claim().state;
    const r = go(state, { type: 'CRASH', window });
    assert.equal(r.status, 'HOLD_CRASH_WINDOW_MANUAL');
    assert.equal(r.state.stage.phase, 'MANUAL_HOLD');
    assert.equal(r.spentMayAlreadyBeCommitted, true);
    assert.equal(r.mustNotRetryOrResume, true);
    assertNoAuthority(r);
    blocked(
      go(r.state, { type: 'RETRY' }),
      'offline_model_cannot_resume_or_release_writer_domain'
    );
  });
}
test('full crash matrix contains all 11 stages exactly once', () => {
  const arr = reviewAllCrossDbCrashWindows();
  assert.equal(arr.length, 11);
  for (const r of arr) {
    assert.equal(r.status, 'HOLD_CRASH_WINDOW_MANUAL');
    assertNoAuthority(r);
  }
});
test('unknown crash marker is rejected', () => {
  blocked(
    go(claim().state, { type: 'CRASH', window: 'remove_all_spent' }),
    'unknown_crash_window'
  );
});
for (const action of ['RETRY', 'RESUME', 'RELEASE_DOMAIN']) {
  test('no offline event can grant high risk action: ' + action, () => {
    blocked(
      go(commit().state, { type: action }),
      'offline_model_cannot_resume_or_release_writer_domain'
    );
  });
}
const reviewPath =
  'docs/plans/READER-REWARD-POINT10X-POSTGRES-CAS-FENCE-SQL-REVIEW-20261105.md';
const originalMarkdown = () =>
  readFileSync(
    fileURLToPath(new URL('../' + reviewPath, import.meta.url)),
    'utf8'
  );
test('SQL review doc contains exactly four guard-protected SQL blocks', () => {
  const r = auditGuardedReviewSql(originalMarkdown(), reviewPath);
  assert.equal(r.status, 'STATIC_REVIEW_GUARDS_PRESENT_NOT_RUNTIME_PROOF');
  assert.equal(r.sqlBlocks, 4);
  assert.equal(r.blockers.length, 0);
  assert.equal(r.sqlExecuted, false);
  assert.equal(r.canAuthorizeExecution, false);
  assert.equal(r.mayRunSql, false);
  assert.ok(Object.isFrozen(r));
});
test('SQL blocks are not importable as live migrations', () => {
  const r = auditGuardedReviewSql(
    originalMarkdown(),
    'supabase/migrations/unsafe.sql'
  );
  assert.ok(r.blockers.includes('sql_candidate_not_in_inert_plan_path'));
  assert.equal(r.mayWriteDb, false);
});
test('deleted guard on CAS block is detected', () => {
  const s = originalMarkdown().replace(
    "RAISE EXCEPTION 'REVIEW_ONLY_NO_GO_DO_NOT_EXECUTE' USING ERRCODE = 'P0001';",
    "RAISE NOTICE 'removed';"
  );
  const r = auditGuardedReviewSql(s, reviewPath);
  assert.ok(r.blockers.some((x) => x.includes('guard_missing_or_after')));
  assert.equal(r.mayRunSql, false);
});
test('new unguarded DDL block is detected', () => {
  const s =
    originalMarkdown() +
    '\n' +
    '~~~'.replaceAll('~', '\u0060') +
    'sql\nBEGIN;\nCREATE TABLE evil(x int);\nCOMMIT;\n' +
    '~~~'.replaceAll('~', '\u0060') +
    '\n';
  const r = auditGuardedReviewSql(s, reviewPath);
  assert.ok(r.blockers.includes('four_guarded_sql_blocks_required'));
  assert.equal(r.mayRunSql, false);
});
test('no review-only notice is not accepted', () => {
  const s = originalMarkdown().replaceAll('REVIEW ONLY / NO-GO', 'NO NOTICE');
  const r = auditGuardedReviewSql(s, reviewPath);
  assert.ok(r.blockers.includes('nonexecution_notice_missing'));
});
test('non-string SQL document cannot be evaluated', () => {
  const r = auditGuardedReviewSql(null, reviewPath);
  assert.ok(r.blockers.includes('markdown_missing'));
  assert.equal(r.mayRunStaging, false);
});
