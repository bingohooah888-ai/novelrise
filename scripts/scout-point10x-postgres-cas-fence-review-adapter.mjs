// NOVELIGHT Point10x: PostgreSQL CAS + Data-Plane fence OFFLINE REVIEW ADAPTER.
// It ONLY returns normalized review references and rejects unsafe fixtures.
// It cannot execute SQL, load secrets, authenticate GitHub or contact a database.
// All inputs are untrusted assertions, not runtime authorization.
import {
  REQUEST_FIELDS,
  OWNER_LOGIN,
  ATOMIC_PROOF_SCOPE,
  ATOMIC_WRITE_SCOPE,
  APPROVAL_MODES,
  SOURCE_RPC_SHA256,
  FIXED_CANDIDATE_RPC_SHA256
} from './scout-point10x-atomic-staging-plan.mjs';
import {
  STAGING_PROJECT,
  PRODUCTION_PROJECT,
  MARKER_SQL_SHA256,
  PRIVATE_SCHEMA
} from './scout-point10x-atomic-execution-contract.mjs';
import { MUTATION_DOMAIN } from './scout-point10x-durable-fence-model.mjs';
import {
  RECOVERY_WRITER_CLASSES,
  RECOVERY_RELATIONS
} from './scout-point10x-recovery-drain-model.mjs';
import { REQUIRED_PRIVILEGED_PATHS } from './scout-point10x-cas-fencing-handoff-model.mjs';

export const POSTGRES_REVIEW_DOCUMENT =
  'docs/plans/READER-REWARD-POINT10X-POSTGRES-CAS-FENCE-SQL-REVIEW-20261105.md';
export const PG_CONTROL_STEPS = Object.freeze([
  'review_schema_and_role_isolation',
  'load_canonical_owner_evidence_on_trusted_main',
  'lock_domain_row_on_primary',
  'check_unused_comment_operation_scope_sha',
  'insert_immutable_spent_tombstone',
  'increment_monotonic_domain_fencing_epoch',
  'commit_single_primary_transaction',
  'requery_primary_if_commit_ack_unknown',
  'publish_github_claim_as_secondary_audit_only'
]);
export const PG_DATA_PLANE_STEPS = Object.freeze([
  'verify_staging_project_excludes_production',
  'catalog_owners_grants_security_definer_and_triggers',
  'deny_new_writes_at_all_legacy_and_privileged_paths',
  'drain_all_nine_writers_and_inflight_retries',
  'verify_db_guard_with_current_fencing_epoch',
  'verify_independent_restore_and_snapshot_digests',
  'review_same_commit_marker_rpc_and_point_unit',
  'read_only_reconcile_unknown_commit',
  'never_resume_writers_without_separate_clearance'
]);
export const PG_REQUIRED_CATALOG_ROUTES = Object.freeze([
  ...REQUIRED_PRIVILEGED_PATHS
]);
export const PG_REVIEW_BLOCKERS = Object.freeze([
  'no_real_postgres_control_plane',
  'no_verified_github_owner_event',
  'no_real_atomic_spent_commit',
  'no_legacy_and_new_writers_db_gate',
  'no_verified_privileged_role_revocations',
  'no_shared_staging_mutation_lock',
  'no_independent_restore_proof',
  'no_read_only_unknown_commit_requery',
  'no_new_owner_staging_execution_approval'
]);
const record = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const pos = (x) => Number.isSafeInteger(x) && x > 0;
const nonneg = (x) => Number.isSafeInteger(x) && x >= 0;
const sha40 = (x) => typeof x === 'string' && /^[0-9a-f]{40}$/u.test(x);
const sha64 = (x) => typeof x === 'string' && /^[0-9a-f]{64}$/u.test(x);
const frozen = (x) => Object.freeze(x);
const err = (arr, ok, code) => {
  if (!ok) arr.push(code);
};
function isExactRequest(r) {
  return (
    record(r) &&
    Object.keys(r).length === REQUEST_FIELDS.length &&
    REQUEST_FIELDS.every((k) => Object.hasOwn(r, k)) &&
    sha40(r.mainSha) &&
    sha40(r.candidateSha) &&
    sha64(r.sourceSnapshotSha256) &&
    r.stagingRef === STAGING_PROJECT &&
    r.stagingRef !== PRODUCTION_PROJECT &&
    r.markerSqlSha256 === MARKER_SQL_SHA256 &&
    r.legacyRpcSha256 === SOURCE_RPC_SHA256 &&
    r.candidateRpcSha256 === FIXED_CANDIDATE_RPC_SHA256 &&
    typeof r.operationId === 'string' &&
    /^[a-z0-9][a-z0-9_-]{7,79}$/u.test(r.operationId) &&
    ((r.scope === ATOMIC_PROOF_SCOPE && r.mode === APPROVAL_MODES.proof) ||
      (r.scope === ATOMIC_WRITE_SCOPE && r.mode === APPROVAL_MODES.persist))
  );
}
const exactClasses = (values, expected, key) =>
  Array.isArray(values) &&
  values.length === expected.length &&
  new Set(values.map((x) => x?.[key])).size === expected.length &&
  expected.every((x) => values.some((v) => v?.[key] === x));
function denial(status, blockers, details = {}) {
  return frozen({
    status,
    blockers: frozen([...new Set(blockers)]),
    ...details,
    executionState: 'nonlive_sql_review_only',
    ownerAuthenticatedInReality: false,
    independentExternalControlDbConnected: false,
    primaryCasActuallyCommitted: false,
    spentTombstonePersisted: false,
    dataPlaneFenceActuallyInstalled: false,
    privilegedPathsActuallyBlocked: false,
    backupRestoredInReality: false,
    actualStagingCommitVerified: false,
    mayAccessSecrets: false,
    mayQueryDb: false,
    mayExecuteSql: false,
    mayWriteDb: false,
    mayRunStaging: false,
    mayPostGithubClaim: false,
    mayModifyProduction: false,
    mayMergeMain: false,
    mayDeploy: false
  });
}
function checkReviewEvidence(e, r, blockers) {
  err(blockers, record(e), 'review_evidence_missing');
  if (!record(e)) return;
  err(
    blockers,
    e.owner === OWNER_LOGIN &&
      e.issueNumber === 294 &&
      e.ownerAssociation === 'OWNER' &&
      e.authorActorMatches === true &&
      e.triggeringActorMatches === true &&
      e.issueHistoryFullyFetched === true &&
      e.verifiedByTrustedMainFixture === true &&
      e.commentId === e.canonicalCommentId &&
      pos(e.commentId) &&
      pos(e.runId),
    'owner_event_and_full_history_not_authenticated'
  );
  err(
    blockers,
    e.mainSha === r?.mainSha &&
      e.candidateSha === r?.candidateSha &&
      e.scope === r?.scope &&
      e.mode === r?.mode &&
      e.projectRef === STAGING_PROJECT,
    'request_head_scope_or_target_mismatch'
  );
  err(
    blockers,
    e.secretsOpened === false &&
      e.githubClaimAlreadyPosted === false &&
      e.approvalPreviouslySpent === false,
    'secret_or_claim_before_durable_primary_cas'
  );
  err(
    blockers,
    nonneg(e.expectedDomainVersion) &&
      nonneg(e.expectedDomainEpoch) &&
      pos(e.runId),
    'invalid_expected_version_epoch_or_run'
  );
}
function checkControlPlane(cp, evidence, blockers) {
  err(blockers, record(cp), 'control_primary_design_missing');
  if (!record(cp)) return;
  const flags = [
    'separateFromStagingAndProduction',
    'serializableSingleTransaction',
    'lockDomainRowForUpdate',
    'spentCommentUnique',
    'spentOperationUnique',
    'spentScopeHeadUnique',
    'persistEpochAndSpendTogether',
    'conditionalNoConcurrentActiveClaim',
    'readOnlyPrimaryRequeryOnLostAck',
    'immutableSpentTombstones',
    'strictPrivateSchemaOwnership',
    'noPublicOrServiceRoleGrant',
    'sharedMutationDomainAcrossOldAndNew',
    'stagingRestoreCannotDecreaseAuthoritativeEpoch',
    'controlPlaneFailureHoldsAllMutations',
    'noAutomaticLeaseExpiryRelease',
    'githubIssueIsSecondaryAudit'
  ];
  for (const field of flags)
    err(blockers, cp[field] === true, 'control_design_missing:' + field);
  err(
    blockers,
    cp.domain === MUTATION_DOMAIN &&
      cp.primaryDomainVersion === evidence?.expectedDomainVersion &&
      cp.primaryDomainEpoch === evidence?.expectedDomainEpoch &&
      nonneg(cp.primaryDomainVersion) &&
      nonneg(cp.primaryDomainEpoch),
    'control_domain_epoch_version_mismatch'
  );
  err(
    blockers,
    cp.controlSchema === PRIVATE_SCHEMA &&
      cp.controlDatabaseRole === 'dedicated_point10x_control_role',
    'control_schema_role_not_pinned'
  );
}
function checkDataPlane(dp, evidence, blockers) {
  err(blockers, record(dp), 'data_plane_design_missing');
  if (!record(dp)) return;
  err(
    blockers,
    dp.domain === MUTATION_DOMAIN &&
      dp.expectedFenceEpoch === evidence?.expectedDomainEpoch + 1 &&
      pos(dp.expectedFenceEpoch),
    'staging_fence_epoch_not_linked_to_primary'
  );
  err(
    blockers,
    dp.targetProject === STAGING_PROJECT &&
      dp.targetProject !== PRODUCTION_PROJECT,
    'staging_target_identity_unverified'
  );
  err(
    blockers,
    exactClasses(dp.writers, RECOVERY_WRITER_CLASSES, 'kind'),
    'writer_registry_incomplete_or_unreviewed'
  );
  for (const kind of RECOVERY_WRITER_CLASSES) {
    const item = Array.isArray(dp.writers)
      ? dp.writers.find((x) => x?.kind === kind)
      : null;
    if (
      !record(item) ||
      item.admissionClosed !== true ||
      item.inflight !== 0 ||
      item.retry !== 0 ||
      item.queued !== 0 ||
      item.outbox !== 0 ||
      item.unacked !== 0 ||
      item.oldEpochRejectedByDb !== true ||
      item.dbEnforcementCatalogChecked !== true
    )
      blockers.push('writer_not_db_fenced_or_drained:' + kind);
  }
  err(
    blockers,
    exactClasses(dp.privileged, PG_REQUIRED_CATALOG_ROUTES, 'path'),
    'privileged_route_registry_incomplete'
  );
  for (const path of PG_REQUIRED_CATALOG_ROUTES) {
    const entry = Array.isArray(dp.privileged)
      ? dp.privileged.find((v) => v?.path === path)
      : null;
    if (
      !record(entry) ||
      entry.revokedOrFencedAtDatabase !== true ||
      entry.bypassImpossibleForAffectedActor !== true ||
      entry.catalogFingerprintChecked !== true
    )
      blockers.push('unfenced_privileged_route:' + path);
  }
  err(
    blockers,
    exactClasses(dp.relations, RECOVERY_RELATIONS, 'relation'),
    'protected_relation_list_incomplete'
  );
  for (const relation of RECOVERY_RELATIONS) {
    const entry = Array.isArray(dp.relations)
      ? dp.relations.find((v) => v?.relation === relation)
      : null;
    if (
      !record(entry) ||
      entry.dmlInsertDeniedWhenFrozen !== true ||
      entry.dmlUpdateDeniedWhenFrozen !== true ||
      entry.dmlDeleteDeniedWhenFrozen !== true ||
      entry.truncateDeniedWhenFrozen !== true ||
      entry.ownershipAclTriggersVerified !== true
    )
      blockers.push('relation_dml_or_truncate_bypass:' + relation);
  }
  for (const field of [
    'legacyRpcCannotBypassFreeze',
    'noUnreviewedOwnerOrSuperuserPath',
    'noForgedSessionGucAsAuthority',
    'fenceSurvivesStagingRestore',
    'allWritersUseSamePrimaryEpoch',
    'fenceHeldThroughUncertainCommit',
    'restoreIndependentOfLiveStaging',
    'noPointXpReversalLoss'
  ])
    err(blockers, dp[field] === true, 'db_enforcement_not_proven:' + field);
}
export function buildPoint10xPostgresReviewAdapter({
  request,
  trustedMainEvidence,
  controlPlane,
  dataPlane
} = {}) {
  const blockers = [];
  err(blockers, isExactRequest(request), 'invalid_exact_staging_request');
  checkReviewEvidence(trustedMainEvidence, request, blockers);
  checkControlPlane(controlPlane, trustedMainEvidence, blockers);
  checkDataPlane(dataPlane, trustedMainEvidence, blockers);
  const controlReview = frozen(
    PG_CONTROL_STEPS.map((step, index) =>
      frozen({
        order: index + 1,
        step,
        document: POSTGRES_REVIEW_DOCUMENT,
        sqlReviewOnly: true,
        linkedToPrimaryEpoch: true
      })
    )
  );
  const stagingReview = frozen(
    PG_DATA_PLANE_STEPS.map((step, index) =>
      frozen({
        order: index + 1,
        step,
        document: POSTGRES_REVIEW_DOCUMENT,
        sqlReviewOnly: true,
        requiresNewStagingApproval: true
      })
    )
  );
  return denial(
    blockers.length
      ? 'HOLD_INVALID_PG_REVIEW_INPUT'
      : 'PG_ADAPTER_REVIEWABLE_BUT_NOT_EXECUTABLE',
    blockers,
    {
      controlReview,
      stagingReview,
      noSqlExecutionEntrypoint: true,
      noRawSqlOrCredentialsInAdapter: true,
      noDistributedAtomicCommitAssumed: true,
      stillBlockedOnRealSecurityReview: PG_REVIEW_BLOCKERS,
      scopeModeWhenProvided: isExactRequest(request)
        ? frozen({ scope: request.scope, mode: request.mode })
        : null
    }
  );
}
export function reviewLostPostgresCasAcknowledgement({
  journalState,
  freshPrimaryReadback,
  stageFence
} = {}) {
  const blockers = [];
  if (
    !['COMMIT_UNKNOWN', 'CRASH_BEFORE_ACK', 'CAS_TIMEOUT'].includes(
      journalState
    )
  )
    blockers.push('invalid_unknown_ack_scenario');
  if (freshPrimaryReadback !== 'INDEPENDENTLY_VERIFIED_SPENT_UNRELEASED')
    blockers.push('primary_requery_missing_or_not_spent');
  if (stageFence !== 'HELD_UNTIL_MANUAL_RECONCILIATION')
    blockers.push('staging_db_fence_not_held');
  return denial('HOLD_ACK_UNKNOWN_NO_RETRY', blockers, {
    neverReplayOperationId: true,
    neverReclaimSpentApproval: true,
    neverAssumeStagingRollbackSafe: true,
    neverResumeWriters: true
  });
}
