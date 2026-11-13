// NOVELIGHT beta Scout Point x10: PURE OFFLINE phase07 transaction model.
// Does not import a DB client or issue SQL/HTTP/GitHub/approval/secret operations.
// It models failure invariants, NOT an executable migration or live proof.
import {
  STAGING_PROJECT,
  PRODUCTION_PROJECT,
  MARKER_SQL_SHA256,
  PRIVATE_SCHEMA,
  MARKER_TABLE,
  TRUSTED_DEFINER,
  WRITER_DB_RELATIONS
} from './scout-point10x-atomic-execution-contract.mjs';
import {
  ATOMIC_PROOF_SCOPE,
  ATOMIC_WRITE_SCOPE,
  APPROVAL_MODES,
  FIXED_CANDIDATE_RPC_SHA256,
  SOURCE_RPC_SHA256
} from './scout-point10x-atomic-staging-plan.mjs';
import { MUTATION_DOMAIN } from './scout-point10x-durable-fence-model.mjs';
import { SCOUT_POINT_10X_RPC_TRIGGER } from '../api/_lib/reader-reward/point-tenfold-writer-cutover-contract.js';

export const POINT10X_TRANSACTION_RELATIONS = Object.freeze([
  ...WRITER_DB_RELATIONS
]);
export const POINT10X_CUTOVER_STAGES = Object.freeze([
  'begin_serializable',
  'lock_five_relations_plus_private_marker_and_xp',
  'fresh_locked_snapshot_and_fence',
  'insert_unique_private_marker',
  'convert_point_ledger',
  'convert_badge_reward_and_threshold',
  'convert_point_badge_progress',
  'convert_operator_actions',
  'verify_xp_unchanged_and_event_integrity',
  'replace_pinned_definer_5_to_50',
  'verify_all_row_acl_rls_trigger_parity',
  'commit_decision'
]);
export const POINT10X_ALLOWED_COMMIT_ACK = Object.freeze([
  'confirmed',
  'rejected',
  'unknown',
  'timeout'
]);
export const POINT10X_AFFECTED_BADGES = Object.freeze([
  'reader_point_100',
  'reader_point_500'
]);
export const POINT10X_POINT_METRIC = 'scout_point_earned_total';
const SAFE_32 = 2147483647;
const SAFE_32_NEG = -2147483648;
const isRecord = (x) =>
  x !== null && typeof x === 'object' && !Array.isArray(x);
const valid40 = (x) => typeof x === 'string' && /^[a-f0-9]{40}$/u.test(x);
const valid64 = (x) => typeof x === 'string' && /^[a-f0-9]{64}$/u.test(x);
const pos = (x) => Number.isSafeInteger(x) && x > 0;
const nonneg = (x) => Number.isSafeInteger(x) && x >= 0;
const deepFreeze = (value) => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
};
const snapshotCopy = (value) => structuredClone(value);
function result(status, blockers, details = {}) {
  return deepFreeze({
    status,
    blockers: [...new Set(blockers)],
    ...details,
    simulationOnly: true,
    externallyVerified: false,
    actualTransactionStarted: false,
    actualMarkerInserted: false,
    actualRpcReplaced: false,
    actualDataChanged: false,
    actualCommitConfirmed: false,
    mayAccessSecrets: false,
    mayPostGithubApproval: false,
    mayPostClaimOrConsumed: false,
    mayRunSql: false,
    mayRunStaging: false,
    mayWriteDb: false,
    mayRestoreDb: false,
    mayResumeWriters: false,
    mayAlterSecurityDefiner: false,
    mayChangeProduction: false,
    mayMergeMain: false,
    mayDeploy: false
  });
}
function tagged(blockers, pass, code) {
  if (!pass) blockers.push(code);
}
const values = (rows, key, where, blockers, relation) => {
  for (const row of rows) {
    if (!where(row)) continue;
    const val = row[key];
    if (
      !Number.isSafeInteger(val) ||
      !Number.isSafeInteger(val * 10) ||
      val * 10 < SAFE_32_NEG ||
      val * 10 > SAFE_32
    )
      blockers.push('overflow_or_invalid_point:' + relation + '.' + key);
  }
};
function safeAmount(number) {
  if (number === null) return null;
  if (!Number.isSafeInteger(number) || !Number.isSafeInteger(number * 10))
    return { error: 'numeric_not_safe_integer' };
  return number * 10;
}
function finiteBag(rows, name, key, blockers) {
  if (!Array.isArray(rows) || !rows.every(isRecord)) {
    blockers.push('malformed_rows:' + name);
    return [];
  }
  const ids = rows.map((row) => row[key]);
  if (
    ids.some((id) => typeof id !== 'string' || id.length === 0) ||
    new Set(ids).size !== ids.length
  )
    blockers.push('row_identity_missing_or_duplicate:' + name);
  return rows;
}
function inspectSnapshot(snapshot) {
  const blockers = [];
  if (!isRecord(snapshot)) return { blockers: ['snapshot_missing_or_invalid'] };
  const surfaces = snapshot.relations;
  if (
    !isRecord(surfaces) ||
    Object.keys(surfaces).length !== POINT10X_TRANSACTION_RELATIONS.length ||
    !POINT10X_TRANSACTION_RELATIONS.every((k) => Object.hasOwn(surfaces, k))
  )
    blockers.push('five_relation_set_not_exact');
  const xp = finiteBag(
    surfaces?.['public.scout_xp_ledger'],
    'xp',
    'id',
    blockers
  );
  const points = finiteBag(
    surfaces?.['public.scout_point_ledger'],
    'points',
    'id',
    blockers
  );
  const badges = finiteBag(
    surfaces?.['public.scout_badge_definitions'],
    'badges',
    'badge_id',
    blockers
  );
  const progress = finiteBag(
    surfaces?.['public.user_scout_badges'],
    'progress',
    'compoundKey',
    blockers
  );
  const operators = finiteBag(
    surfaces?.['public.scout_point_operator_actions'],
    'operators',
    'id',
    blockers
  );
  tagged(
    blockers,
    points.every(
      (row) => typeof row.event_key === 'string' && row.event_key.length > 0
    ) && new Set(points.map((row) => row.event_key)).size === points.length,
    'point_event_key_missing_or_duplicate'
  );
  tagged(
    blockers,
    points.every(
      (row) =>
        row.metadata === null ||
        (isRecord(row.metadata) &&
          !Object.hasOwn(row.metadata, 'point_unit_version') &&
          !Object.hasOwn(row.metadata, 'unit_version'))
    ),
    'preexisting_row_unit_marker_or_bad_metadata'
  );
  tagged(
    blockers,
    progress.every(
      (row) => row.compoundKey === row.user_id + '::' + row.badge_id
    ),
    'badge_progress_identity_mismatch'
  );
  const metricBadges = badges.filter(
    (b) => b.metric_key === POINT10X_POINT_METRIC
  );
  tagged(
    blockers,
    metricBadges.length === 2 &&
      POINT10X_AFFECTED_BADGES.every((id) =>
        metricBadges.some((b) => b.badge_id === id)
      ),
    'unreviewed_point_threshold_metric'
  );
  values(points, 'point_value', () => true, blockers, 'point_ledger');
  values(badges, 'point_reward', () => true, blockers, 'badge_definitions');
  values(
    operators,
    'amount',
    (row) => row.amount !== null,
    blockers,
    'operator_actions'
  );
  tagged(
    blockers,
    badges.every(
      (b) =>
        Number.isSafeInteger(b.target_value) &&
        Number.isSafeInteger(
          b.metric_key === POINT10X_POINT_METRIC
            ? b.target_value * 10
            : b.target_value
        )
    ),
    'badge_threshold_64bit_precision_unverified'
  );
  tagged(
    blockers,
    progress.every(
      (p) =>
        Number.isSafeInteger(p.progress_value) &&
        Number.isSafeInteger(
          POINT10X_AFFECTED_BADGES.includes(p.badge_id)
            ? p.progress_value * 10
            : p.progress_value
        )
    ),
    'badge_progress_64bit_precision_unverified'
  );
  tagged(
    blockers,
    xp.every(
      (row) => typeof row.event_key === 'string' && row.event_key.length > 0
    ) && new Set(xp.map((row) => row.event_key)).size === xp.length,
    'xp_event_identity_invalid_or_duplicate'
  );
  tagged(
    blockers,
    Array.isArray(snapshot.privateMarkers) &&
      snapshot.privateMarkers.length === 0,
    'marker_already_present_or_unreadable'
  );
  tagged(
    blockers,
    snapshot.currentUnit === '1pt_per_yen',
    'unknown_or_previously_converted_unit'
  );
  tagged(
    blockers,
    snapshot.fullRowDigest &&
      valid64(snapshot.fullRowDigest) &&
      nonneg(snapshot.sourceSequence),
    'locked_source_digest_or_sequence_invalid'
  );
  return { blockers, xp, points, badges, progress, operators };
}
function reviewPrerequisites({ request, claim, proof, snapshot }) {
  const blockers = [];
  tagged(
    blockers,
    isRecord(request) &&
      valid40(request.mainSha) &&
      valid40(request.candidateSha) &&
      request.stagingRef === STAGING_PROJECT &&
      request.stagingRef !== PRODUCTION_PROJECT,
    'exact_staging_request_and_head_required'
  );
  tagged(
    blockers,
    isRecord(request) &&
      valid64(request.sourceSnapshotSha256) &&
      request.markerSqlSha256 === MARKER_SQL_SHA256 &&
      request.legacyRpcSha256 === SOURCE_RPC_SHA256 &&
      request.candidateRpcSha256 === FIXED_CANDIDATE_RPC_SHA256,
    'request_snapshot_marker_or_rpc_digests_unpinned'
  );
  tagged(
    blockers,
    isRecord(request) &&
      ((request.scope === ATOMIC_PROOF_SCOPE &&
        request.mode === APPROVAL_MODES.proof) ||
        (request.scope === ATOMIC_WRITE_SCOPE &&
          request.mode === APPROVAL_MODES.persist)),
    'atomic_scope_and_mode_mismatch'
  );
  tagged(
    blockers,
    isRecord(claim) &&
      claim.status === 'SYMBOLIC_CAS_COMMITTED_NOT_REAL' &&
      isRecord(claim.store?.active) &&
      Array.isArray(claim.store?.spent) &&
      claim.store.spent.some(
        (x) =>
          x.operationId === request?.operationId &&
          x.candidateSha === request?.candidateSha
      ) &&
      claim.store.domain === MUTATION_DOMAIN &&
      pos(claim.store.fencingEpoch) &&
      claim.store.active.fencingEpoch === claim.store.fencingEpoch &&
      claim.store.active.operationId === request?.operationId &&
      claim.store.active.scope === request?.scope &&
      claim.store.active.mode === request?.mode &&
      claim.store.active.mainSha === request?.mainSha &&
      claim.store.active.candidateSha === request?.candidateSha,
    'symbolic_one_shot_claim_fence_unproven'
  );
  tagged(
    blockers,
    isRecord(proof) &&
      proof.trustedMainPinned === true &&
      proof.ownerIssue294HistoryVerified === true &&
      proof.mainSha === request?.mainSha &&
      proof.candidateSha === request?.candidateSha &&
      proof.dedicatedStagingRef === STAGING_PROJECT,
    'owner_trusted_main_and_head_not_verified'
  );
  tagged(
    blockers,
    isRecord(proof) &&
      proof.drainStatus === 'MODEL_DRAIN_PREREQUISITES_ONLY' &&
      proof.backupStatus === 'MODEL_INDEPENDENT_BACKUP_PREREQUISITES_ONLY' &&
      proof.allWriterClassesFenced === true &&
      proof.fencingEpoch === claim?.store?.fencingEpoch &&
      proof.writerFenceHeldThroughDecision === true &&
      proof.allWriterAdmissionsClosed === true,
    'prior_writer_drain_and_backup_not_proven'
  );
  tagged(
    blockers,
    isRecord(proof) &&
      proof.dbLockIncludesXpAndFiveRelations === true &&
      proof.dbTransactionIsolation === 'serializable' &&
      proof.postgresSecurityDefinerCatalogIndependentlyChecked === true &&
      proof.migrationStaticRollbackOnlyCandidateNotUsedAsCutover === true &&
      proof.eventReversalsAndStatusesReconciled === true &&
      proof.allRowAndTriggerAclRlsParityVerified === true,
    'transaction_locks_and_row_integrity_not_proven'
  );
  tagged(
    blockers,
    isRecord(proof) &&
      proof.sourceFullRowDigest === snapshot?.fullRowDigest &&
      proof.sourceSequence === snapshot?.sourceSequence &&
      proof.pointWritesAfterSnapshot === 0 &&
      proof.xpWritesAfterSnapshot === 0 &&
      proof.externalSideEffectsAfterSnapshot === 0,
    'source_drift_or_new_point_xp_events'
  );
  tagged(
    blockers,
    isRecord(proof) &&
      proof.privateSchema === PRIVATE_SCHEMA &&
      proof.privateMarkerTable === MARKER_TABLE &&
      proof.privateSchemaNotExposed === true &&
      proof.privateMarkerDdlSha256Verified === true &&
      proof.markerUniqueScopeTargetAndApproval === true &&
      proof.markerRoleGrantsDenied === true &&
      proof.authoritativeMarkerAbsent === true,
    'private_marker_schema_or_uniqueness_unverified'
  );
  tagged(
    blockers,
    isRecord(proof) &&
      proof.rpcSignature === TRUSTED_DEFINER &&
      proof.rpcTrigger === SCOUT_POINT_10X_RPC_TRIGGER &&
      proof.oldRpcAward === 5 &&
      proof.newRpcAward === 50 &&
      proof.sourceRpcSha256 === SOURCE_RPC_SHA256 &&
      proof.candidateRpcSha256 === FIXED_CANDIDATE_RPC_SHA256 &&
      proof.singleAwardTokenChanged === true &&
      proof.securityDefinerPreserved === true &&
      proof.ownerAclSearchPathTriggerSame === true &&
      proof.eventKeyIdempotencyUnchanged === true,
    'exact_security_definer_rpc_parity_unverified'
  );
  tagged(
    blockers,
    isRecord(proof) &&
      proof.expectedTargetUnit === '10pt_per_yen' &&
      proof.separateProductionGateRequired === true &&
      proof.explicitScopeReviewOnly === true,
    'unit_target_or_independent_production_gate_missing'
  );
  return blockers;
}
function project(snapshot, request, claim) {
  const after = snapshotCopy(snapshot);
  const surfaces = after.relations;
  for (const row of surfaces['public.scout_point_ledger'])
    row.point_value = safeAmount(row.point_value);
  for (const row of surfaces['public.scout_badge_definitions']) {
    row.point_reward = safeAmount(row.point_reward);
    if (row.metric_key === POINT10X_POINT_METRIC) row.target_value *= 10;
  }
  for (const row of surfaces['public.user_scout_badges'])
    if (POINT10X_AFFECTED_BADGES.includes(row.badge_id))
      row.progress_value *= 10;
  for (const row of surfaces['public.scout_point_operator_actions'])
    if (row.amount !== null) row.amount = safeAmount(row.amount);
  // XP ledger, event keys, reversal linkage and every non-unit column untouched.
  after.privateMarkers.push({
    cutoverScope: request.scope,
    targetUnitVersion: '10pt_per_yen',
    approvalCommentId: claim.store.active.requestCommentId,
    operationId: request.operationId,
    mainSha: request.mainSha,
    candidateSha: request.candidateSha,
    fencingEpoch: claim.store.fencingEpoch
  });
  after.currentUnit = '10pt_per_yen';
  // PostgreSQL's canonical full-row digest/watermark must be independently
  // remeasured after a real cutover; do not reuse the source fingerprint.
  after.fullRowDigest = null;
  after.sourceSequence = null;
  after.postCommitFingerprintUnverified = true;
  // The symbolic representation stores only digests and award value;
  // it does NOT include runnable SQL or a CREATE OR REPLACE function.
  after.rpc = {
    signature: TRUSTED_DEFINER,
    trigger: SCOUT_POINT_10X_RPC_TRIGGER,
    sourceSha256: SOURCE_RPC_SHA256,
    targetSha256: FIXED_CANDIDATE_RPC_SHA256,
    oldAwardPoint: 5,
    newAwardPoint: 50,
    exactSingleTokenCandidateOnly: true
  };
  return after;
}
function validateProjection(before, after, blockers) {
  const first = before.relations,
    second = after.relations;
  for (const key of POINT10X_TRANSACTION_RELATIONS) {
    tagged(
      blockers,
      second[key].length === first[key].length,
      'relation_row_count_drift:' + key
    );
  }
  tagged(
    blockers,
    JSON.stringify(second['public.scout_xp_ledger']) ===
      JSON.stringify(first['public.scout_xp_ledger']),
    'xp_relation_mutated'
  );
  for (const [relation, k, valueFn] of [
    ['public.scout_point_ledger', 'point_value', (row) => row.point_value * 10],
    [
      'public.scout_badge_definitions',
      'point_reward',
      (row) => row.point_reward * 10
    ],
    [
      'public.scout_point_operator_actions',
      'amount',
      (row) => (row.amount === null ? null : row.amount * 10)
    ]
  ]) {
    for (let i = 0; i < first[relation].length; i++) {
      const old = first[relation][i],
        now = second[relation][i];
      const expected = { ...old, [k]: valueFn(old) };
      if (
        relation === 'public.scout_badge_definitions' &&
        old.metric_key === POINT10X_POINT_METRIC
      )
        expected.target_value = old.target_value * 10;
      tagged(
        blockers,
        JSON.stringify(now) === JSON.stringify(expected),
        'unexpected_non_unit_row_change:' + relation
      );
    }
  }
  for (let i = 0; i < first['public.scout_badge_definitions'].length; i++) {
    const a = first['public.scout_badge_definitions'][i];
    const b = second['public.scout_badge_definitions'][i];
    tagged(
      blockers,
      b.target_value ===
        (a.metric_key === POINT10X_POINT_METRIC
          ? a.target_value * 10
          : a.target_value),
      'badge_threshold_unit_mismatch'
    );
  }
  for (let i = 0; i < first['public.user_scout_badges'].length; i++) {
    const a = first['public.user_scout_badges'][i];
    const b = second['public.user_scout_badges'][i];
    const expected = POINT10X_AFFECTED_BADGES.includes(a.badge_id)
      ? a.progress_value * 10
      : a.progress_value;
    tagged(
      blockers,
      JSON.stringify(b) === JSON.stringify({ ...a, progress_value: expected }),
      'badge_progress_nonunit_drift'
    );
  }
  tagged(
    blockers,
    second['public.scout_point_ledger'].every(
      (row, i) =>
        row.event_key === first['public.scout_point_ledger'][i].event_key &&
        row.status === first['public.scout_point_ledger'][i].status &&
        row.reversal_of === first['public.scout_point_ledger'][i].reversal_of
    ),
    'event_keys_statuses_reversal_links_mutated'
  );
  tagged(
    blockers,
    after.privateMarkers.length === 1 &&
      after.rpc.newAwardPoint === 50 &&
      after.rpc.targetSha256 === FIXED_CANDIDATE_RPC_SHA256 &&
      after.currentUnit === '10pt_per_yen',
    'marker_rpc_or_unit_not_in_same_projection'
  );
}
/**
 * Each returned artifact is a review of a hypothetical transaction. Even
 * 'REVIEW_ONLY_ATOMIC_PROJECTION' is NOT permission to commit or execute SQL.
 */
export function reviewScoutPoint10xAtomicUnitTransaction({
  snapshot,
  request,
  claim,
  proof,
  failAt = null,
  commitAck = 'confirmed'
} = {}) {
  const original = snapshot === undefined ? null : snapshotCopy(snapshot);
  const blockers = [
    ...reviewPrerequisites({ request, claim, proof, snapshot }),
    ...inspectSnapshot(snapshot).blockers
  ];
  tagged(
    blockers,
    failAt === null || POINT10X_CUTOVER_STAGES.includes(failAt),
    'unknown_fault_checkpoint'
  );
  tagged(
    blockers,
    POINT10X_ALLOWED_COMMIT_ACK.includes(commitAck),
    'invalid_commit_acknowledgement'
  );
  if (blockers.length)
    return result('HOLD_PREFLIGHT_OR_SOURCE_DRIFT', blockers, {
      baseline: original,
      candidate: null,
      transactionOutcome: 'not_started'
    });
  if (failAt !== null && failAt !== 'commit_decision') {
    return result('MODEL_ROLLBACK_AT_FAULT', ['injected_fault:' + failAt], {
      baseline: original,
      candidate: null,
      transactionOutcome: 'rolled_back_in_model',
      faultStage: failAt,
      approvalMustRemainSpent: true,
      noPartialUnitConversionVisible: true
    });
  }
  if (
    failAt === 'commit_decision' ||
    commitAck === 'unknown' ||
    commitAck === 'timeout'
  ) {
    return result(
      'HOLD_AMBIGUOUS_COMMIT_NOT_RETRYABLE',
      ['commit_outcome_unverifiable_without_read_only_requery'],
      {
        baseline: original,
        candidate: null,
        transactionOutcome: 'unknown',
        approvalMustRemainSpent: true,
        noAutomaticRollbackOrRetry: true,
        writerFenceMustRemainHeld: true
      }
    );
  }
  if (commitAck === 'rejected') {
    return result('MODEL_COMMIT_REJECTED_ROLLBACK_ONLY', [], {
      baseline: original,
      candidate: null,
      transactionOutcome: 'rejected',
      approvalMustRemainSpent: true
    });
  }
  const candidate = project(snapshot, request, claim);
  validateProjection(snapshot, candidate, blockers);
  if (blockers.length)
    return result('HOLD_POSTCHECK_ROW_PARITY', blockers, {
      baseline: original,
      candidate: null,
      transactionOutcome: 'not_committed'
    });
  return result('REVIEW_ONLY_ATOMIC_PROJECTION', [], {
    baseline: original,
    candidate,
    stages: POINT10X_CUTOVER_STAGES,
    transactionOutcome: 'hypothetical_only',
    genuineCommitEvidence: false,
    markerAndRpcMustShareSingleDatabaseCommit: true,
    previousApprovalNeverReusable: true,
    newOwnerApprovalRequiredForStaging: true
  });
}
export function reviewScoutPoint10xAtomicFailureMatrix(params = {}) {
  const outcomes = POINT10X_CUTOVER_STAGES.map((stage) =>
    reviewScoutPoint10xAtomicUnitTransaction({ ...params, failAt: stage })
  );
  return result('OFFLINE_FAULT_MATRIX_ONLY', [], {
    outcomes,
    checkpoints: POINT10X_CUTOVER_STAGES.length
  });
}
