// Point10x: PURE OFFLINE failure-window model; NO DB, SQL, secrets or authority.
import { MUTATION_DOMAIN } from './scout-point10x-durable-fence-model.mjs';
import {
  newOfflineCasJournal,
  simulateOfflineAtomicOwnerClaim,
  simulateOfflineFenceAllWriters,
  REQUIRED_PRIVILEGED_PATHS
} from './scout-point10x-cas-fencing-handoff-model.mjs';
import { RECOVERY_RELATIONS } from './scout-point10x-recovery-drain-model.mjs';
import { STAGING_PROJECT } from './scout-point10x-atomic-execution-contract.mjs';

export const CROSS_DB_CRASH_WINDOWS = Object.freeze([
  'before_primary_begin',
  'after_primary_lock_before_spent_insert',
  'after_spent_insert_before_primary_commit',
  'after_primary_commit_before_ack',
  'after_primary_ack_before_stage_fence',
  'after_stage_fence_before_independent_restore',
  'after_restore_before_stage_transaction',
  'during_stage_transaction_before_commit',
  'after_stage_commit_before_ack',
  'after_stage_ack_before_reconciliation',
  'after_reconciliation_before_writer_reopen'
]);
export const CROSS_DB_EVENTS = Object.freeze([
  'CLAIM',
  'FENCE',
  'PREPARE',
  'STAGE_COMMIT',
  'RECONCILE',
  'CRASH',
  'RETRY',
  'RESUME',
  'RELEASE_DOMAIN'
]);
const obj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const pos = (n) => Number.isSafeInteger(n) && n > 0;
const sha64 = (x) => typeof x === 'string' && /^[a-f0-9]{64}$/u.test(x);
function deepFreeze(x) {
  if (x !== null && typeof x === 'object' && !Object.isFrozen(x)) {
    for (const child of Object.values(x)) deepFreeze(child);
    Object.freeze(x);
  }
  return x;
}
function review(status, state, blockers = [], extra = {}) {
  return deepFreeze({
    status,
    state,
    blockers: [...new Set(blockers)],
    ...extra,
    provenance: 'offline_untrusted_fixture',
    distributedCommitProven: false,
    realOwnerAuthenticated: false,
    realSpentLedgerUpdated: false,
    realDataPlaneFenced: false,
    realBackupRestored: false,
    realCutoverCommitted: false,
    realReconciliationPerformed: false,
    mayReadSecrets: false,
    mayQueryDb: false,
    mayRunSql: false,
    mayWriteDb: false,
    mayRunStaging: false,
    mayPostApprovalOrClaim: false,
    mayResumeWriters: false,
    mayReleaseDomain: false,
    mayMergeMain: false,
    mayDeploy: false,
    mayModifyProduction: false
  });
}
export function createCrossDbOfflineReviewState() {
  return deepFreeze({
    domain: MUTATION_DOMAIN,
    control: newOfflineCasJournal(),
    stage: {
      project: STAGING_PROJECT,
      phase: 'UNFENCED',
      localEpoch: null,
      unit: '1pt_per_yen',
      rpcAward: 5,
      marker: 'ABSENT',
      writerFenceConfirmed: false,
      backupRestoreConfirmed: false,
      originalDigest: null
    },
    history: []
  });
}
function validState(s) {
  return (
    obj(s) &&
    obj(s.control) &&
    obj(s.stage) &&
    s.domain === MUTATION_DOMAIN &&
    s.control.domain === MUTATION_DOMAIN &&
    s.stage.project === STAGING_PROJECT &&
    Array.isArray(s.history)
  );
}
function mutate(s, stage, history, control = s.control) {
  return deepFreeze({
    ...s,
    control,
    stage: { ...s.stage, ...stage },
    history: [...s.history, history]
  });
}
function preparationErrors(s, e) {
  if (!obj(e)) return ['independent_backup_evidence_absent'];
  const blockers = [];
  for (const k of [
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
  ])
    if (e[k] !== true) blockers.push('preparation_unproven:' + k);
  if (!sha64(e.sourceDigest)) blockers.push('source_digest_invalid');
  if (
    !pos(e.epoch) ||
    e.epoch !== s.control.epoch ||
    e.epoch !== s.stage.localEpoch
  )
    blockers.push('cross_db_epoch_mismatch');
  if (
    !Array.isArray(e.relations) ||
    e.relations.length !== RECOVERY_RELATIONS.length ||
    new Set(e.relations).size !== RECOVERY_RELATIONS.length ||
    !RECOVERY_RELATIONS.every((r) => e.relations.includes(r))
  )
    blockers.push('five_relation_inventory_incomplete');
  if (
    !Array.isArray(e.privilegedPaths) ||
    e.privilegedPaths.length !== REQUIRED_PRIVILEGED_PATHS.length ||
    new Set(e.privilegedPaths).size !== REQUIRED_PRIVILEGED_PATHS.length ||
    !REQUIRED_PRIVILEGED_PATHS.every((p) => e.privilegedPaths.includes(p))
  )
    blockers.push('privileged_path_inventory_incomplete');
  return blockers;
}
const committed = (r) =>
  r?.marker === 'PRESENT' && r?.unit === '10pt_per_yen' && r?.rpcAward === 50;
const rolledBack = (r) =>
  r?.marker === 'ABSENT' && r?.unit === '1pt_per_yen' && r?.rpcAward === 5;
export function stepCrossDbOfflineReview({ state, event } = {}) {
  if (!validState(state))
    return review('HOLD_BAD_STATE', state, ['invalid_state']);
  if (!obj(event) || !CROSS_DB_EVENTS.includes(event.type))
    return review('HOLD_BAD_EVENT', state, ['unknown_transition']);
  if (event.type === 'CLAIM') {
    if (state.stage.phase !== 'UNFENCED' || state.control.active !== null)
      return review('HOLD_CAS', state, ['domain_already_claimed']);
    const r = simulateOfflineAtomicOwnerClaim({
      journal: state.control,
      request: event.request,
      ownerFixture: event.ownerFixture,
      commentId: event.commentId,
      runId: event.runId,
      expectedVersion: event.expectedVersion,
      expectedEpoch: event.expectedEpoch
    });
    if (r.status !== 'SYMBOLIC_CAS_SPENT_NOT_REAL')
      return review('HOLD_CAS', state, r.blockers);
    return review(
      'MODEL_PRIMARY_CAS_COMMITTED_STAGE_UNFENCED',
      mutate(state, { phase: 'PRIMARY_SPENT_UNFENCED' }, 'CLAIM', r.journal),
      [],
      { spentOnlyInModel: true, discreteDbRiskWindow: true }
    );
  }
  if (event.type === 'FENCE') {
    if (state.stage.phase !== 'PRIMARY_SPENT_UNFENCED')
      return review('HOLD_FENCE', state, ['primary_spent_not_confirmed']);
    const r = simulateOfflineFenceAllWriters({
      journal: state.control,
      runId: event.runId,
      epoch: event.epoch,
      writerEvidence: event.writerEvidence,
      privilegedEvidence: event.privilegedEvidence
    });
    if (r.status !== 'SYMBOLIC_ALL_FENCED_NOT_REAL')
      return review('HOLD_FENCE', state, r.blockers);
    return review(
      'MODEL_DB_FENCE_NOT_ACTUAL',
      mutate(
        state,
        {
          phase: 'FENCED',
          localEpoch: r.journal.epoch,
          writerFenceConfirmed: true
        },
        'FENCE',
        r.journal
      )
    );
  }
  if (event.type === 'PREPARE') {
    if (state.stage.phase !== 'FENCED' || !state.stage.writerFenceConfirmed)
      return review('HOLD_PREPARE', state, ['continuous_db_fence_unverified']);
    const blockers = preparationErrors(state, event.evidence);
    if (blockers.length) return review('HOLD_PREPARE', state, blockers);
    return review(
      'MODEL_PREPARED_ONLY',
      mutate(
        state,
        {
          phase: 'PREPARED',
          backupRestoreConfirmed: true,
          originalDigest: event.evidence.sourceDigest
        },
        'PREPARE'
      )
    );
  }
  if (event.type === 'STAGE_COMMIT') {
    if (state.stage.phase !== 'PREPARED')
      return review('HOLD_STAGE_COMMIT', state, [
        'no_fenced_verified_preparation'
      ]);
    if (event.outcome === 'committed')
      return review(
        'MODEL_COMMIT_ASSERTION_NO_LIVE_PROOF',
        mutate(
          state,
          {
            phase: 'COMMIT_ASSERTED',
            unit: '10pt_per_yen',
            rpcAward: 50,
            marker: 'PRESENT'
          },
          'COMMIT_ASSERTED'
        )
      );
    if (event.outcome === 'rolled_back')
      return review(
        'MODEL_ROLLBACK_ASSERTION_NO_LIVE_PROOF',
        mutate(
          state,
          {
            phase: 'ROLLBACK_ASSERTED',
            unit: '1pt_per_yen',
            rpcAward: 5,
            marker: 'ABSENT'
          },
          'ROLLBACK_ASSERTED'
        ),
        [],
        { spentTombstoneMustRemain: true }
      );
    if (['unknown', 'timeout'].includes(event.outcome))
      return review(
        'HOLD_COMMIT_ACK_UNKNOWN',
        mutate(
          state,
          {
            phase: 'COMMIT_UNKNOWN',
            unit: 'UNKNOWN',
            rpcAward: 'UNKNOWN',
            marker: 'UNKNOWN'
          },
          'COMMIT_ACK_UNKNOWN'
        ),
        ['read_only_primary_and_stage_requery_required'],
        { noAutomaticReplayOrRestore: true }
      );
    return review('HOLD_STAGE_COMMIT', state, ['invalid_commit_response']);
  }
  if (event.type === 'RECONCILE') {
    if (
      !['COMMIT_UNKNOWN', 'COMMIT_ASSERTED', 'ROLLBACK_ASSERTED'].includes(
        state.stage.phase
      )
    )
      return review('HOLD_READBACK', state, ['commit_outcome_not_pending']);
    const e = event.readback,
      blockers = [];
    if (!obj(e))
      blockers.push('read_only_primary_and_staging_evidence_missing');
    if (
      e?.controlSpent !== true ||
      e?.controlEpoch !== state.control.epoch ||
      e?.stagingEpoch !== state.stage.localEpoch ||
      e?.dbWriterFenceStillHeld !== true
    )
      blockers.push('control_spent_or_stage_epoch_mismatch');
    if (
      !Number.isSafeInteger(e?.readOnlySamples) ||
      e.readOnlySamples < 2 ||
      e.fullRowDigestAndSequenceMatched !== true ||
      e.xpPointReversalsConserved !== true ||
      e.externalSideEffectsConserved !== true ||
      e.functionAclRlsTriggerParity !== true
    )
      blockers.push('postcommit_integrity_unproven');
    const isCommit = committed(e),
      isRollback = rolledBack(e);
    if (!isCommit && !isRollback) blockers.push('mixed_marker_rpc_unit');
    if (state.stage.phase === 'COMMIT_ASSERTED' && !isCommit)
      blockers.push('commit_ack_contradicts_database');
    if (state.stage.phase === 'ROLLBACK_ASSERTED' && !isRollback)
      blockers.push('rollback_ack_contradicts_database');
    if (blockers.length)
      return review(
        'HOLD_RECONCILIATION_CONFLICT',
        mutate(
          state,
          {
            phase: 'MANUAL_HOLD'
          },
          'READBACK_CONFLICT'
        ),
        blockers
      );
    return review(
      isCommit ? 'MODEL_COMMIT_READBACK_ONLY' : 'MODEL_ROLLBACK_READBACK_ONLY',
      mutate(
        state,
        {
          phase: isCommit ? 'REVIEW_COMMITTED' : 'REVIEW_ROLLED_BACK',
          unit: e.unit,
          rpcAward: e.rpcAward,
          marker: e.marker
        },
        'READBACK'
      ),
      [],
      {
        approvalRemainsSpent: true,
        resumeRequiresNewOwnerGate: true
      }
    );
  }
  if (event.type === 'CRASH') {
    if (!CROSS_DB_CRASH_WINDOWS.includes(event.window))
      return review('HOLD_UNKNOWN_CRASH_WINDOW', state, [
        'unknown_crash_window'
      ]);
    return review(
      'HOLD_CRASH_WINDOW_MANUAL',
      mutate(
        state,
        {
          phase: 'MANUAL_HOLD'
        },
        'CRASH_' + event.window
      ),
      ['primary_and_staging_read_only_requery_required'],
      {
        crashWindow: event.window,
        spentMayAlreadyBeCommitted: true,
        mustNotRetryOrResume: true
      }
    );
  }
  return review(
    'HOLD_MANUAL_OWNER_CONTROL',
    state,
    ['offline_model_cannot_resume_or_release_writer_domain'],
    { attempted: event.type }
  );
}
export function reviewAllCrossDbCrashWindows() {
  const state = createCrossDbOfflineReviewState();
  return deepFreeze(
    CROSS_DB_CRASH_WINDOWS.map((window) =>
      stepCrossDbOfflineReview({ state, event: { type: 'CRASH', window } })
    )
  );
}
export function auditGuardedReviewSql(markdown, path) {
  const blockers = [];
  const expectedPath =
    'docs/plans/READER-REWARD-POINT10X-POSTGRES-CAS-FENCE-SQL-REVIEW-20261105.md';
  if (path !== expectedPath)
    blockers.push('sql_candidate_not_in_inert_plan_path');
  if (typeof markdown !== 'string') blockers.push('markdown_missing');
  const chunks =
    typeof markdown === 'string'
      ? [...markdown.matchAll(/^\x60{3}sql\s*\n([\s\S]*?)^\x60{3}\s*$/gmu)].map(
          (x) => x[1]
        )
      : [];
  if (chunks.length !== 4) blockers.push('four_guarded_sql_blocks_required');
  for (const [i, sql] of chunks.entries()) {
    if (
      !/^\s*BEGIN(?:\s+TRANSACTION(?:\s+ISOLATION\s+LEVEL\s+SERIALIZABLE)?|\s+READ\s+ONLY)?\s*;/u.test(
        sql
      )
    )
      blockers.push('sql_transaction_begin_missing:' + i);
    const at = sql.search(
      /DO \$stop\$ BEGIN\s+RAISE EXCEPTION 'REVIEW_ONLY_NO_GO_DO_NOT_EXECUTE' USING ERRCODE = 'P0001';\s+END \$stop\$;/u
    );
    const first = sql.search(
      /\b(?:CREATE|ALTER|DROP|REVOKE|GRANT|INSERT|UPDATE|DELETE|SELECT|TRUNCATE)\b/iu
    );
    if (at < 0 || (first >= 0 && at > first))
      blockers.push('guard_missing_or_after_risky_statement:' + i);
    if (!/\b(?:COMMIT|ROLLBACK)\s*;\s*$/u.test(sql))
      blockers.push('terminal_statement_missing:' + i);
  }
  if (typeof markdown === 'string' && !markdown.includes('REVIEW ONLY / NO-GO'))
    blockers.push('nonexecution_notice_missing');
  return deepFreeze({
    status: blockers.length
      ? 'HOLD_REVIEW_SQL_DOC'
      : 'STATIC_REVIEW_GUARDS_PRESENT_NOT_RUNTIME_PROOF',
    blockers,
    sqlBlocks: chunks.length,
    sqlExecuted: false,
    canAuthorizeExecution: false,
    mayQueryDb: false,
    mayRunSql: false,
    mayRunStaging: false,
    mayWriteDb: false,
    mayDeploy: false
  });
}
