// NOVELIGHT beta Scout Point x10 — synthetic-only atomic cutover contract.
// No network, database, SQL, migration runner, or approval side effects.
// The Stage and Production execution gates remain separate, unauthorised.
import {
  SCOUT_POINT_10X_SCOPE,
  SCOUT_POINT_10X_RPC_LEGACY_SHA256,
  SCOUT_POINT_10X_WRITER_CLASSES
} from './point-tenfold-writer-cutover-contract.js';

export const SCOUT_10X_ATOMIC_STAGES = Object.freeze([
  '01_identity_scope_and_current_sha_fence',
  '02_backup_and_independent_restore',
  '03_drain_all_old_unit_point_writers',
  '04_db_exclusive_fence_and_serializable_snapshot',
  '05_insert_private_unique_cutover_marker',
  '06_convert_point_ledger',
  '07_convert_badge_point_rewards',
  '08_convert_point_milestone_thresholds',
  '09_convert_point_badge_progress',
  '10_convert_operator_adjustments',
  '11_replace_security_definer_level_up_5_with_50',
  '12_reconcile_all_rows_function_and_privileges',
  '13_commit_all_changes_once',
  '14_observe_before_resuming_writers'
]);
export const SCOUT_10X_APPROVAL_MODES = Object.freeze({
  rollbackProof: 'atomic-rollback-only-proof',
  persistentStaging: 'atomic-persistent-staging-cutover'
});
export const SCOUT_10X_PRIVATE_MARKER_REQUIREMENTS = Object.freeze({
  proposedSchema: 'novelight_reward_private',
  uniqueKey: '(cutover_scope, target_unit_version)',
  targetUnit: '10pt_per_yen',
  restrictedDdlAndDml: true,
  exposedToAnonOrAuthenticated: false,
  requiresIndependentPrivilegeAudit: true,
  createdInAnyDatabase: false
});
export const SCOUT_10X_REQUIRED_GATES = Object.freeze([
  'latest_main_master_and_safety_gates',
  'trusted_owner_issue_294_workflow_on_main',
  'separate_head_bound_once_only_scope_for_proof',
  'independent_new_scope_for_persistent_staging_mutation',
  'full_staging_backup_and_independent_restore',
  'all_point_writer_triggers_rpcs_edge_cron_service_role_inventoried',
  'all_old_unit_writers_fenced_and_inflight_jobs_drained',
  'database_enforced_exclusive_writer_barrier',
  'unexposed_private_unique_marker_acl_and_constraint',
  'legacy_rpc_source_sha256_exact_one_token_delta',
  'security_definer_owner_acl_search_path_and_trigger_parity',
  'single_transaction_marker_ledger_badge_progress_operator_rpc',
  'full_row_event_key_xp_reversal_and_status_reconciliation',
  'rollback_fault_injection_before_persistent_commit',
  'postcommit_recovery_no_restore_of_stale_snapshot_after_new_awards',
  'stage_read_rpc_and_ui_consistency_before_reopen',
  'new_separate_owner_production_mutation_authorization'
]);
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const safeInt = (n) => Number.isSafeInteger(n);
const nonneg = (n) => safeInt(n) && n >= 0;
const clone = (v) => JSON.parse(JSON.stringify(v));
const freeze = (v) => Object.freeze(v);
const failClosed = (status, extra = {}) =>
  freeze({
    status,
    ...extra,
    evidenceType: 'synthetic_local_only',
    liveStagingVerified: false,
    liveProductionVerified: false,
    independentlyAuthorized: false,
    mayExecuteSql: false,
    mayCreateMarker: false,
    mayAlterRpc: false,
    mayChangeStaging: false,
    mayChangeProduction: false,
    mayDeploy: false,
    mayMergeMain: false,
    mayPayReward: false,
    mayRunAi: false
  });
const STATUSES = new Set(['confirmed', 'pending', 'frozen', 'cancelled']);
const TRANSFORM_ID = 'synthetic:reader-reward-point10x:unique-once';

export function quoteScout10xStagingExecutionBoundary({
  mainSha,
  candidateSha,
  stagingRef,
  issueNumber,
  scope,
  mode,
  ownerAuthenticated = false,
  oneTimeClaimAvailable = false,
  trustedWorkflowIsOnMain = false,
  independentlyVerifiedRestore = false,
  allWritersFenced = false,
  noInflightAward = false,
  rpcSecurityReviewed = false,
  privateMarkerDdlReviewed = false,
  recoveryProcedureReviewed = false
} = {}) {
  const missing = [];
  if (
    !/^[a-f0-9]{40}$/.test(mainSha ?? '') ||
    !/^[a-f0-9]{40}$/.test(candidateSha ?? '') ||
    mainSha === candidateSha
  )
    missing.push('fresh_distinct_main_and_candidate_sha');
  if (stagingRef !== 'wmlzjgvxgoyrovdhbqbg')
    missing.push('dedicated_staging_project_ref');
  if (
    issueNumber !== 294 ||
    scope !== SCOUT_POINT_10X_SCOPE ||
    !ownerAuthenticated ||
    !oneTimeClaimAvailable
  )
    missing.push('owner_bound_one_time_issue294_scope');
  if (!Object.values(SCOUT_10X_APPROVAL_MODES).includes(mode))
    missing.push('approved_exact_mode');
  if (!trustedWorkflowIsOnMain)
    missing.push('trusted_main_workflow_unavailable');
  if (!independentlyVerifiedRestore) missing.push('backup_restore_evidence');
  if (!allWritersFenced || !noInflightAward)
    missing.push('full_writer_fence_and_drain');
  if (!rpcSecurityReviewed) missing.push('security_definer_parity');
  if (!privateMarkerDdlReviewed) missing.push('private_unique_marker');
  if (!recoveryProcedureReviewed) missing.push('safe_postcommit_recovery');
  return failClosed(
    missing.length
      ? 'pre_execution_dependencies_unverified_hold'
      : 'caller_asserted_dependencies_only_not_authorization',
    {
      missing: freeze(missing),
      exactMode: mode ?? null,
      existingRollbackOnlyScopeCanPersist: false,
      directOwnerCommentDoesNotGrantDatabaseAccess: true,
      requiresSeparateStagingWriteApproval: true,
      requiresIndependentRuntimeVerification: true,
      requiredGates: SCOUT_10X_REQUIRED_GATES
    }
  );
}

function ensureRows(state, name, uniqueKey) {
  const rows = state[name];
  if (!Array.isArray(rows) || rows.length > 1000)
    throw new TypeError('Invalid synthetic table: ' + name);
  const ids = rows.map(uniqueKey);
  if (
    ids.some((k) => typeof k !== 'string' || !k) ||
    new Set(ids).size !== ids.length
  )
    throw new RangeError('Missing or duplicated synthetic row key: ' + name);
}
function validateSyntheticState(s) {
  if (
    !record(s) ||
    s.source !== 'synthetic-local-only' ||
    !['1pt_per_yen', '10pt_per_yen'].includes(s.unit) ||
    !record(s.marker) ||
    !record(s.rpc)
  )
    throw new TypeError('Only a versioned synthetic snapshot is accepted');
  ensureRows(s, 'ledger', (r) => r.eventKey);
  ensureRows(s, 'badges', (r) => r.badgeId);
  ensureRows(s, 'progress', (r) => r.userId + ':' + r.badgeId);
  ensureRows(s, 'operatorActions', (r) => r.id);
  ensureRows(s, 'xp', (r) => r.id);
  for (const x of s.ledger) {
    if (
      !record(x) ||
      !safeInt(x.points) ||
      Math.abs(x.points) > 100000 ||
      !STATUSES.has(x.status) ||
      typeof x.userId !== 'string' ||
      typeof x.id !== 'string' ||
      typeof x.eventKey !== 'string'
    )
      throw new TypeError('Invalid/overflow synthetic Point ledger');
  }
  for (const x of s.badges) {
    if (
      !record(x) ||
      !nonneg(x.reward) ||
      x.reward > 214748364 ||
      !nonneg(x.target) ||
      x.target > Math.floor(Number.MAX_SAFE_INTEGER / 10) ||
      typeof x.metric !== 'string'
    )
      throw new TypeError('Invalid/overflow synthetic badge');
  }
  for (const x of s.progress) {
    if (
      !record(x) ||
      !safeInt(x.value) ||
      !safeInt(x.value * 10) ||
      typeof x.earned !== 'boolean' ||
      !nonneg(x.percent)
    )
      throw new TypeError('Invalid/overflow synthetic Point progress');
  }
  for (const x of s.operatorActions) {
    if (
      !record(x) ||
      (x.amount !== null && (!safeInt(x.amount) || Math.abs(x.amount) > 10000))
    )
      throw new RangeError('Invalid/overflow synthetic operator action');
  }
  for (const x of s.xp) {
    if (!record(x) || !safeInt(x.value)) throw new TypeError('Invalid XP row');
  }
  if (
    s.rpc.sourceSha256 !== SCOUT_POINT_10X_RPC_LEGACY_SHA256 ||
    ![5, 50].includes(s.rpc.points) ||
    s.rpc.securityDefiner !== true ||
    s.rpc.owner !== 'postgres' ||
    s.rpc.searchPath !== '' ||
    JSON.stringify(s.rpc.executeAcl) !==
      JSON.stringify(['postgres', 'service_role']) ||
    s.rpc.eventKeyPolicy !== 'user-level-unique'
  )
    throw new TypeError('Untrusted synthetic RPC baseline');
  if (
    s.marker.cutoverId !== null &&
    (typeof s.marker.cutoverId !== 'string' || !s.marker.cutoverId)
  )
    throw new TypeError('Malformed synthetic marker');
}
function checkSyntheticControls(c) {
  if (!record(c)) throw new TypeError('Synthetic controls object required');
  if (c.mode !== 'local-simulation' || c.projectRef !== 'synthetic-local-only')
    return 'not_an_isolated_synthetic_environment';
  for (const k of [
    'ownerScopeReviewed',
    'independentBackupRestored',
    'allWritersPaused',
    'exclusiveDatabaseFence',
    'noInflightAwards',
    'serializableSnapshot',
    'exactRpcDiffReviewed',
    'privateMarkerReviewed',
    'noExistingMarker',
    'fullRowReconciliation'
  ]) {
    if (c[k] !== true) return k;
  }
  if (
    !Array.isArray(c.pausedWriterClasses) ||
    !SCOUT_POINT_10X_WRITER_CLASSES.every((k) =>
      c.pausedWriterClasses.includes(k)
    )
  )
    return 'not_all_writer_classes_paused';
  if (!Array.isArray(c.unknownWriters) || c.unknownWriters.length)
    return 'unclassified_writers_not_drained';
  return null;
}

/**
 * A PURE model of a single logical transaction. Failures BEFORE COMMIT
 * restore the original synthetic snapshot; failures AFTER COMMIT require
 * recovery analysis and must never claim ROLLBACK. Not a real DB transaction.
 */
export function simulateScout10xAtomicCutover({
  snapshot,
  controls,
  failAfterStage = null
} = {}) {
  validateSyntheticState(snapshot);
  const initial = clone(snapshot);
  const blocked = checkSyntheticControls(controls);
  const unchanged = (status, more = {}) =>
    failClosed(status, {
      ...more,
      before: freeze(clone(initial)),
      after: freeze(clone(initial)),
      committedToAnyDatabase: false,
      simulatedCommit: false
    });
  if (blocked)
    return unchanged('synthetic_precondition_hold', { blockedBy: blocked });
  if (
    snapshot.unit !== '1pt_per_yen' ||
    snapshot.marker.cutoverId !== null ||
    snapshot.rpc.points !== 5
  )
    return unchanged('already_converted_or_marker_conflict_hold');
  if (
    failAfterStage !== null &&
    !SCOUT_10X_ATOMIC_STAGES.includes(failAfterStage)
  )
    throw new RangeError('Unknown synthetic fault injection stage');
  const working = clone(initial);
  const steps = [];
  const at = (step) => {
    steps.push(step);
    if (step === failAfterStage)
      throw new Error('SYNTHETIC_FAILURE_AFTER_' + step);
  };
  try {
    at('01_identity_scope_and_current_sha_fence');
    at('02_backup_and_independent_restore');
    at('03_drain_all_old_unit_point_writers');
    at('04_db_exclusive_fence_and_serializable_snapshot');
    working.marker.cutoverId = TRANSFORM_ID;
    working.marker.unit = '10pt_per_yen';
    at('05_insert_private_unique_cutover_marker');
    for (const row of working.ledger) row.points *= 10;
    at('06_convert_point_ledger');
    for (const row of working.badges) row.reward *= 10;
    at('07_convert_badge_point_rewards');
    for (const row of working.badges)
      if (row.metric === 'scout_point_earned_total') row.target *= 10;
    at('08_convert_point_milestone_thresholds');
    const pointBadges = new Set(
      working.badges
        .filter((x) => x.metric === 'scout_point_earned_total')
        .map((x) => x.badgeId)
    );
    for (const row of working.progress)
      if (pointBadges.has(row.badgeId)) row.value *= 10;
    at('09_convert_point_badge_progress');
    for (const row of working.operatorActions)
      if (row.amount !== null) row.amount *= 10;
    at('10_convert_operator_adjustments');
    working.rpc.points = 50;
    at('11_replace_security_definer_level_up_5_with_50');
    working.unit = '10pt_per_yen';
    const expected = clone(initial);
    expected.unit = '10pt_per_yen';
    expected.marker = {
      ...expected.marker,
      cutoverId: TRANSFORM_ID,
      unit: '10pt_per_yen'
    };
    expected.rpc = { ...expected.rpc, points: 50 };
    for (const row of expected.ledger) row.points *= 10;
    for (const row of expected.badges) {
      row.reward *= 10;
      if (row.metric === 'scout_point_earned_total') row.target *= 10;
    }
    for (const row of expected.progress)
      if (pointBadges.has(row.badgeId)) row.value *= 10;
    for (const row of expected.operatorActions)
      if (row.amount !== null) row.amount *= 10;
    if (JSON.stringify(expected) !== JSON.stringify(working))
      throw new Error('SYNTHETIC_FULL_ROW_MISMATCH');
    at('12_reconcile_all_rows_function_and_privileges');
    at('13_commit_all_changes_once');
    at('14_observe_before_resuming_writers');
    return failClosed('synthetic_atomic_transition_demonstrated_only', {
      before: freeze(initial),
      after: freeze(working),
      exercisedStages: freeze(steps),
      simulatedCommit: true,
      committedToAnyDatabase: false,
      markerWasCreatedInRealDb: false,
      rpcWasChangedInRealDb: false,
      noVerifiedServiceRoleOrCronFence: true,
      requiresSeparateLiveProof: true
    });
  } catch (error) {
    if (steps.includes('13_commit_all_changes_once')) {
      return failClosed('synthetic_post_commit_failure_recovery_hold', {
        before: freeze(initial),
        after: freeze(working),
        reason: error.message,
        executedStages: freeze(steps),
        simulatedCommit: true,
        simulatedRollback: false,
        noAutomaticStaleBackupRestore: true,
        recoveryRequiresEventJournalAndSeparateApproval: true,
        committedToAnyDatabase: false
      });
    }
    return unchanged('synthetic_atomic_rollback', {
      reason: error.message,
      executedStages: freeze(steps),
      simulatedRollback: true,
      markerAndRpcRestored: true
    });
  }
}

/** A post-commit snapshot is NOT safely replaceable after new awards. */
export function quoteScout10xPostCommitRecovery({
  committed = false,
  newLegitimateAwards = 0,
  backupUnit,
  postCommitUnit,
  markerPresent = false,
  independentEventJournalVerified = false,
  proposal = 'restore_old_snapshot'
} = {}) {
  const blockers = [];
  if (committed !== true) blockers.push('no_verified_committed_cutover');
  if (!nonneg(newLegitimateAwards)) blockers.push('unknown_new_awards');
  if (
    backupUnit !== '1pt_per_yen' ||
    postCommitUnit !== '10pt_per_yen' ||
    !markerPresent
  )
    blockers.push('unit_or_marker_mismatch');
  if (!independentEventJournalVerified)
    blockers.push('independent_new_event_journal_missing');
  if (proposal === 'restore_old_snapshot' && newLegitimateAwards > 0)
    blockers.push('stale_restore_would_erase_new_awards');
  if (
    !['restore_old_snapshot', 'forward_repair_with_journal'].includes(proposal)
  )
    blockers.push('unreviewed_recovery_strategy');
  return failClosed(
    blockers.length
      ? 'post_commit_recovery_hold'
      : 'recovery_review_candidate_only',
    {
      blockers: freeze(blockers),
      restoreOldSnapshotAllowed: false,
      forwardRepairRequiresSeparateOwnerApproval: true,
      postCommitRecoveryExecuted: false,
      immutableEventHistoryMustBePreserved: true
    }
  );
}
