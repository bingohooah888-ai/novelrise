// NOVELIGHT beta Scout Point 10x: trust-boundary PLAN only.
// Not a workflow entrypoint. No DB, API, GitHub, process or filesystem effects.
// Never pass caller-supplied fields from this module to a live executor.
import {
  ATOMIC_POINT10X_SCOPE,
  LEGACY_PROOF_SCOPE,
  MARKER_SQL_SHA256,
  STAGING_PROJECT,
  PRODUCTION_PROJECT,
  ISSUE_NUMBER,
  reviewScout10xAtomicApproval,
  reviewScoutAtomicExecutorDependencies
} from './scout-point10x-atomic-execution-contract.mjs';
import {
  SCOUT_POINT_10X_RPC_LEGACY_SHA256,
  SCOUT_POINT_10X_WRITER_CLASSES
} from '../api/_lib/reader-reward/point-tenfold-writer-cutover-contract.js';

export const OWNER_LOGIN = 'bingohooah888-ai';
export const REPO = OWNER_LOGIN + '/novelrise';
export const ISSUE_TITLE = '[Staging Control] Supabase migration sync';
export const ATOMIC_PROOF_SCOPE = ATOMIC_POINT10X_SCOPE + '-rollback';
export const ATOMIC_WRITE_SCOPE = ATOMIC_POINT10X_SCOPE + '-persist';
export const APPROVAL_MODES = Object.freeze({
  proof: 'atomic-rollback-only-proof',
  persist: 'atomic-persistent-staging-cutover'
});
export const REQUEST = 'NOVELIGHT_STAGING_READER_POINT10X_ATOMIC_REQUEST ';
export const CLAIMED = 'NOVELIGHT_STAGING_READER_POINT10X_ATOMIC_CLAIMED ';
export const CONSUMED = 'NOVELIGHT_STAGING_READER_POINT10X_ATOMIC_CONSUMED ';
export const FIXED_CANDIDATE_RPC_SHA256 =
  '4401e5fe070e4cce3512f4c39a5b9cd59fc67ae17145244b78b95a3f48a48742';
export const SOURCE_RPC_SHA256 = SCOUT_POINT_10X_RPC_LEGACY_SHA256;
export const REQUEST_FIELDS = Object.freeze([
  'scope',
  'mode',
  'mainSha',
  'candidateSha',
  'stagingRef',
  'operationId',
  'sourceSnapshotSha256',
  'markerSqlSha256',
  'legacyRpcSha256',
  'candidateRpcSha256'
]);
export const LEDGER_FIELDS = Object.freeze([
  'requestCommentId',
  'operationId',
  'scope',
  'mode',
  'mainSha',
  'candidateSha',
  'runId'
]);
export const CONSUMED_FIELDS = Object.freeze([...LEDGER_FIELDS, 'result']);
export const PLAN_STAGES = Object.freeze([
  'fresh_main_master_and_safe_gate',
  'trusted_main_owner_issue_294_approval',
  'atomic_claim_recorded_before_staging_secrets',
  'confirm_dedicated_staging_identity_against_production',
  'verify_independent_full_backup_restore_and_fingerprint',
  'stop_all_old_and_new_point_writers_and_drain_inflight',
  'prove_db_enforced_fence_across_service_role_and_legacy_rpc',
  'transaction_begin_serializable_and_lock_five_point_relations_plus_xp',
  'recheck_latest_source_unit_rpc_and_full_row_snapshot',
  'insert_unique_private_unit_marker_and_audit',
  'convert_ledger_badge_rewards_point_thresholds_progress_and_operator',
  'replace_exact_pinned_security_definer_level_up_5_with_50',
  'reconcile_all_rows_xp_status_event_keys_reversals_trigger_acl_and_rls',
  'transaction_decision',
  'verify_final_state_and_no_old_unit_writers',
  'record_outcome_and_consume_approval',
  'do_not_resume_writers_without_separate_verification'
]);
export const REQUIRED_STAGING_EVIDENCE = Object.freeze([
  'latestMainAndPrHeadFromGithub',
  'trustedMainWorkflowFromCurrentMain',
  'ownerIssue294MachineReadableOneShot',
  'backupRestoredInIndependentPostgres',
  'wholeRowBackupAndFreshLockedSnapshotMatch',
  'allNineWriterClassesAndKnownRpcsInventoried',
  'cronEdgeQueueRetriesAndInFlightZero',
  'serviceRoleDirectSqlAndLegacyDefinerFenced',
  'xpAndPointWriterLocksAndDurableVersionFence',
  'privateSchemaNotExposedAndPrivilegesReviewed',
  'markerUniqueClaimAndSourceDigestReviewed',
  'legacyRpcBodyAndExactSingleTokenDiffReviewed',
  'functionOwnerAclSearchPathAndTriggerEqual',
  'allLedgerBadgeProgressOperatorAndXpRowsReconciled',
  'beforeCommitFaultInjectionAndRollbackReviewed',
  'ambiguousCommitCanBeResolvedByReadOnlyRequery',
  'postCommitForwardRepairAndEventJournalReviewed'
]);
const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9_-]{7,79}$/;
const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const validSha = (s, re) => typeof s === 'string' && re.test(s);
const fail = (status, info = {}) =>
  Object.freeze({
    status,
    ...info,
    trustLevel: 'self_reported_review_only',
    independentlyAuthorized: false,
    approvalConsumed: false,
    realRunStarted: false,
    mayReadSecrets: false,
    mayExecuteSql: false,
    mayWriteStaging: false,
    mayAlterDefiner: false,
    mayCreateMarker: false,
    mayPauseWriters: false,
    mayWriteProduction: false,
    mayMergeMain: false,
    mayDeploy: false
  });
const strictKeys = (x, keys) =>
  object(x) &&
  Object.keys(x).length === keys.length &&
  keys.every((k) => Object.prototype.hasOwnProperty.call(x, k));
const signature = (scope, mode) =>
  (scope === ATOMIC_PROOF_SCOPE && mode === APPROVAL_MODES.proof) ||
  (scope === ATOMIC_WRITE_SCOPE && mode === APPROVAL_MODES.persist);
const parseCanonical = (body, prefix, keys) => {
  if (
    typeof body !== 'string' ||
    body.length > 3600 ||
    !body.startsWith(prefix)
  )
    return null;
  const raw = body.slice(prefix.length);
  try {
    const parsed = JSON.parse(raw);
    if (!strictKeys(parsed, keys) || JSON.stringify(parsed) !== raw)
      return null;
    return parsed;
  } catch {
    return null;
  }
};

/**
 * Existing Issue #294's rollout contract remains unchanged. This request
 * parser is NOT a new owner-authentication mechanism; GitHub metadata must
 * be read independently by a future trusted-main workflow.
 */
export function inspectScoutAtomicOwnerRequest({
  repository,
  issue,
  comment,
  actor,
  triggeringActor,
  currentMainSha,
  candidatePr,
  allIssueComments,
  allPagesFetched = false,
  trustedMainWorkflowReviewed = false
} = {}) {
  const blockers = [];
  if (
    repository !== REPO ||
    issue?.number !== ISSUE_NUMBER ||
    issue?.title !== ISSUE_TITLE ||
    issue?.user?.login !== OWNER_LOGIN ||
    issue?.pull_request !== undefined
  )
    blockers.push('wrong_issue_294_identity_or_type');
  if (
    comment?.user?.login !== OWNER_LOGIN ||
    comment?.author_association !== 'OWNER' ||
    actor !== OWNER_LOGIN ||
    triggeringActor !== OWNER_LOGIN ||
    !Number.isSafeInteger(comment?.id) ||
    comment?.id <= 0
  )
    blockers.push('owner_comment_and_github_actor_not_authenticated');
  const req = parseCanonical(comment?.body, REQUEST, REQUEST_FIELDS);
  if (!req) blockers.push('invalid_noncanonical_or_duplicate_request_fields');
  if (req) {
    if (!signature(req.scope, req.mode) || req.scope === LEGACY_PROOF_SCOPE)
      blockers.push('wrong_atomic_scope_or_legacy_approval_reuse');
    if (
      req.stagingRef !== STAGING_PROJECT ||
      req.stagingRef === PRODUCTION_PROJECT
    )
      blockers.push('incorrect_staging_target');
    if (
      !validSha(req.mainSha, SHA40) ||
      !validSha(req.candidateSha, SHA40) ||
      req.mainSha !== currentMainSha ||
      req.mainSha === req.candidateSha ||
      candidatePr?.headSha !== req.candidateSha ||
      candidatePr?.baseSha !== currentMainSha ||
      candidatePr?.draft !== true ||
      candidatePr?.merged !== false
    )
      blockers.push('stale_or_wrong_main_candidate_head');
    if (
      !validSha(req.sourceSnapshotSha256, SHA64) ||
      !validSha(req.markerSqlSha256, SHA64) ||
      req.markerSqlSha256 !== MARKER_SQL_SHA256 ||
      req.legacyRpcSha256 !== SOURCE_RPC_SHA256 ||
      req.candidateRpcSha256 !== FIXED_CANDIDATE_RPC_SHA256
    )
      blockers.push('unreviewed_backup_marker_or_rpc_digest');
    if (typeof req.operationId !== 'string' || !ID.test(req.operationId))
      blockers.push('invalid_operation_id');
  }
  if (!trustedMainWorkflowReviewed)
    blockers.push('trusted_main_workflow_unavailable_or_unreviewed');
  if (
    allPagesFetched !== true ||
    !Array.isArray(allIssueComments) ||
    allIssueComments.length > 10000
  )
    blockers.push('approval_history_not_complete');
  else {
    for (const entry of allIssueComments) {
      if (!object(entry) || typeof entry.body !== 'string') {
        blockers.push('malformed_issue_comment_history');
        break;
      }
      const isLedger = [CLAIMED, CONSUMED].some((p) =>
        entry.body.startsWith(p)
      );
      if (!isLedger) continue;
      const kind = entry.body.startsWith(CLAIMED) ? CLAIMED : CONSUMED;
      const item = parseCanonical(
        entry.body,
        kind,
        kind === CLAIMED ? LEDGER_FIELDS : CONSUMED_FIELDS
      );
      if (!item || !Number.isSafeInteger(item.requestCommentId)) {
        blockers.push('noncanonical_or_malformed_owner_ledger');
        break;
      }
      if (
        entry.user?.login !== OWNER_LOGIN &&
        entry.user?.login !== 'github-actions[bot]'
      ) {
        blockers.push('untrusted_actor_wrote_claim_ledger');
        break;
      }
      if (
        req &&
        (item.requestCommentId === comment?.id ||
          item.operationId === req.operationId ||
          (item.scope === req.scope && item.candidateSha === req.candidateSha))
      )
        blockers.push('claim_or_consumed_already_exists');
    }
  }
  return fail(
    blockers.length
      ? 'atomic_owner_request_denied'
      : 'canonical_request_reviewed_not_authenticated',
    {
      blockers: Object.freeze([...new Set(blockers)]),
      reviewedRequest: req ? Object.freeze({ ...req }) : null,
      newOwnerApprovalRequired: true,
      previousRollbackApprovalInvalid: true,
      actualGithubSignedOwnerEvidenceMustBeRechecked: true,
      commentsMustBeFetchedUntilNoNextPage: true,
      claimBeforeAnySecretAccess: true,
      failuresAndCancellationMustConsumeOnce: true,
      exactGithubCommentId: comment?.id ?? null
    }
  );
}

/**
 * Deterministic planning for a hypothetical trusted-main runtime.
 * No SQL emitted, no triggers installed, no secrets loaded, no DB accessed.
 * Counterfactual success of this function is never an authorization.
 */
export function compileScoutAtomicStagingReviewPlan({
  ownerRequest,
  atomicContract,
  scope,
  mode,
  assetHashes,
  stagingEvidence = {},
  simulateUncertainCommit = false
} = {}) {
  const blockers = [];
  if (ownerRequest?.status !== 'canonical_request_reviewed_not_authenticated')
    blockers.push('owner_request_not_reviewed');
  if (atomicContract?.status !== 'all_claimed_evidence_still_not_authorization')
    blockers.push('atomic_dependency_contract_incomplete');
  if (!signature(scope, mode)) blockers.push('atomic_scope_mode_incompatible');
  if (
    scope !== ownerRequest?.reviewedRequest?.scope ||
    mode !== ownerRequest?.reviewedRequest?.mode
  )
    blockers.push('owner_request_scope_and_mode_mismatch');
  if (
    !strictKeys(assetHashes ?? {}, [
      'markerSqlSha256',
      'legacyRpcSha256',
      'candidateRpcSha256'
    ])
  )
    blockers.push('asset_manifest_not_exact');
  else if (
    assetHashes.markerSqlSha256 !== MARKER_SQL_SHA256 ||
    assetHashes.legacyRpcSha256 !== SOURCE_RPC_SHA256 ||
    assetHashes.candidateRpcSha256 !== FIXED_CANDIDATE_RPC_SHA256
  )
    blockers.push('asset_digest_drift');
  if (
    !object(stagingEvidence) ||
    REQUIRED_STAGING_EVIDENCE.some((k) => stagingEvidence[k] !== true)
  )
    blockers.push('not_all_staging_evidence_independently_observed');
  if (simulateUncertainCommit === true)
    blockers.push('uncertain_commit_requires_fresh_read_only_requery');
  const stageSpecs = PLAN_STAGES.map((name, i) =>
    Object.freeze({
      sequence: i + 1,
      name,
      executableByThisModule: false,
      irreversibleOrExternal: name === 'transaction_decision',
      requiredBoundary:
        name === 'transaction_decision'
          ? mode === APPROVAL_MODES.proof
            ? 'ALWAYS_ROLLBACK'
            : 'OWNER_SEPARATELY_APPROVED_STAGING_COMMIT'
          : 'NO_INDEPENDENT_COMMIT'
    })
  );
  return fail(
    blockers.length
      ? 'atomic_staging_plan_blocked'
      : 'atomic_staging_review_plan_only',
    {
      blockers: Object.freeze([...new Set(blockers)]),
      immutableStages: Object.freeze(stageSpecs),
      proposedTransactionDecision:
        mode === APPROVAL_MODES.proof
          ? 'ROLLBACK'
          : 'COMMIT_REQUIRES_NEW_TRUSTED_EXECUTOR_AND_OWNER',
      anyClaimedSuccessIsLiveProof: false,
      markerDdlInExecutableMigration: false,
      stagingTarget: STAGING_PROJECT,
      noRunningExecutableSqlProduced: true,
      disallowLegacyWorkflowApprovalReuse: true,
      persistentStagingRequiresIndependentlySignedOneUseApproval: true
    }
  );
}

export function quoteScoutAtomicFailureDisposition({
  stage,
  commitState,
  newPointEventsAfterCommit = 0,
  readOnlyMarkerRequeryVerified = false,
  independentEventJournalVerified = false
} = {}) {
  const blockers = [];
  if (!PLAN_STAGES.includes(stage)) blockers.push('unknown_execution_stage');
  if (!['not_committed', 'committed', 'ambiguous'].includes(commitState))
    blockers.push('commit_state_not_verified');
  if (
    !Number.isSafeInteger(newPointEventsAfterCommit) ||
    newPointEventsAfterCommit < 0
  )
    blockers.push('unknown_new_point_events');
  if (commitState === 'ambiguous' && !readOnlyMarkerRequeryVerified)
    blockers.push(
      'unknown_commit_requires_read_only_marker_and_ledger_requery'
    );
  if (commitState === 'committed' && !independentEventJournalVerified)
    blockers.push('postcommit_event_journal_not_proven');
  if (commitState === 'committed' && newPointEventsAfterCommit > 0)
    blockers.push('stale_backup_restore_would_destroy_new_awards');
  return fail(
    blockers.length ? 'recovery_safe_hold' : 'recovery_disposition_review_only',
    {
      blockers: Object.freeze(blockers),
      canClaimRealRollback: false,
      staleRestoreMayRun: false,
      commitBeforeBoundaryRollbackIsHypothetical:
        commitState === 'not_committed',
      afterCommitNeedsForwardRepair: commitState === 'committed',
      ambiguousCommitNeedsExternalReadOnlyProof: commitState === 'ambiguous',
      writerResumePermitted: false,
      requiresSeparateOwnerRecoveryApproval: commitState !== 'not_committed'
    }
  );
}
