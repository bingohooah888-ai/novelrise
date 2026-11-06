// NOVELIGHT Scout Point 10x: inert, trusted-main-intended, one-shot ledger DESIGN.
// No GitHub, filesystem, process, network, DB, secret, workflow, or deployment IO.
// This is NOT an approval authority or implementation of a live Staging executor.
import {
  CLAIMED,
  CONSUMED,
  LEDGER_FIELDS,
  CONSUMED_FIELDS,
  OWNER_LOGIN,
  REPO,
  ATOMIC_PROOF_SCOPE,
  ATOMIC_WRITE_SCOPE,
  APPROVAL_MODES,
  inspectScoutAtomicOwnerRequest
} from './scout-point10x-atomic-staging-plan.mjs';

export const LEDGER_PHASES = Object.freeze([
  'UNSEEN',
  'REQUEST_REVIEWED',
  'CLAIM_UNCONFIRMED',
  'CLAIMED',
  'CONSUMED',
  'DENIED'
]);
export const TERMINAL_OUTCOMES = Object.freeze([
  'success',
  'failure',
  'cancelled',
  'interrupted',
  'uncertain'
]);
export const CLAIM_PRECONDITIONS = Object.freeze([
  'fresh_trusted_main_sha_rechecked',
  'fresh_candidate_draft_pr_head_rechecked',
  'github_issue_294_owner_event_authenticated_by_trusted_main',
  'all_issue_294_comment_pages_verified',
  'exclusive_owner_scope_operation_concurrency_serialized',
  'claim_written_before_any_staging_secret_or_db_contact',
  'claim_re_read_after_write_by_trusted_main',
  'no_previous_claim_or_consume_for_comment_operation_or_scope_head',
  'no_replay_of_old_rollback_scope',
  'staging_ref_distinct_from_production',
  'new_scope_mode_and_asset_hashes_pinned'
]);
export const RECOVERY_PRECONDITIONS = Object.freeze([
  'backup_restore_verified_in_independent_database',
  'source_and_restored_all_row_digests_equal',
  'function_acl_trigger_rls_and_unit_version_match',
  'writer_fence_still_active',
  'original_event_journal_accessible_without_secret_logging',
  'commit_outcome_resolved_from_read_only_primary_and_marker',
  'no_old_backup_overwrite_after_new_valid_points',
  'owner_approved_forward_repair_if_post_commit'
]);
const record = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const safeId = (x) => Number.isSafeInteger(x) && x > 0;
const sha = (x) => typeof x === 'string' && /^[a-f0-9]{40}$/u.test(x);
const keys = (v, expected) =>
  record(v) &&
  Object.keys(v).length === expected.length &&
  expected.every((k) => Object.prototype.hasOwnProperty.call(v, k));
const parse = (body, prefix, fields) => {
  if (
    typeof body !== 'string' ||
    body.length > 3800 ||
    !body.startsWith(prefix)
  )
    return null;
  const value = body.slice(prefix.length);
  try {
    const x = JSON.parse(value);
    if (!keys(x, fields) || JSON.stringify(x) !== value) return null;
    return x;
  } catch {
    return null;
  }
};
const freeze = (x) => Object.freeze(x);
const result = (status, data = {}) =>
  freeze({
    status,
    ...data,
    proofType: 'non_authoritative_offline_design',
    independentlyAuthenticated: false,
    ownerApprovalRegistered: false,
    ledgerClaimPosted: false,
    ledgerConsumedPosted: false,
    mayUseStagingSecrets: false,
    mayExecuteSql: false,
    mayRunStaging: false,
    mayChangeProduction: false,
    mayCreateMarker: false,
    mayAlterSecurityDefiner: false,
    mayUnlockWriters: false,
    mayMergeMain: false,
    mayDeploy: false,
    mayGrantApproval: false
  });
const errorBlock = (reason) =>
  result('one_shot_ledger_hold', { blockers: freeze([reason]) });
const same = (recorded, request, commentId) => {
  return (
    recorded.requestCommentId === commentId ||
    recorded.operationId === request.operationId ||
    (recorded.scope === request.scope &&
      recorded.candidateSha === request.candidateSha)
  );
};

/**
 * Verify that an entire, caller-supplied Issue #294 ledger is internally
 * consistent. Caller evidence is not GitHub-authenticated proof.
 *
 * Historic malformed marker entries fail closed, even if unrelated.
 * CLAIMED counts as used regardless of terminal outcome.
 */
export function inspectScoutAtomicOneShotLedger({
  requestReview,
  comments = [],
  allPagesFetched = false,
  repository = REPO,
  trustedMainOnly = false,
  serializedForScope = false,
  candidateHeadStillCurrent = false,
  currentMainSha
} = {}) {
  const blockers = [];
  if (
    requestReview?.status !== 'canonical_request_reviewed_not_authenticated' ||
    !record(requestReview.reviewedRequest) ||
    !safeId(requestReview.exactGithubCommentId)
  )
    blockers.push('request_not_reviewed_or_comment_id_invalid');
  const req = requestReview?.reviewedRequest,
    commentId = requestReview?.exactGithubCommentId;
  if (repository !== REPO || trustedMainOnly !== true)
    blockers.push('trusted_main_and_repository_not_proven');
  if (
    allPagesFetched !== true ||
    !Array.isArray(comments) ||
    comments.length > 10000
  )
    blockers.push('incomplete_github_issue_history');
  if (serializedForScope !== true)
    blockers.push('atomic_concurrent_claim_serialization_unproven');
  if (
    candidateHeadStillCurrent !== true ||
    !sha(currentMainSha) ||
    req?.mainSha !== currentMainSha
  )
    blockers.push('fresh_main_or_candidate_head_unproven');
  const allClaims = [];
  const allConsumed = [];
  if (Array.isArray(comments) && comments.length <= 10000) {
    const seenIds = new Set();
    for (const comment of comments) {
      if (
        !record(comment) ||
        !safeId(comment.id) ||
        typeof comment.body !== 'string'
      ) {
        blockers.push('invalid_issue_history_comment');
        break;
      }
      if (seenIds.has(comment.id)) blockers.push('duplicated_issue_comment_id');
      seenIds.add(comment.id);
      const marker = comment.body.startsWith(CLAIMED)
        ? CLAIMED
        : comment.body.startsWith(CONSUMED)
          ? CONSUMED
          : null;
      if (!marker) continue;
      if (
        comment.user?.login !== OWNER_LOGIN &&
        comment.user?.login !== 'github-actions[bot]'
      ) {
        blockers.push('untrusted_claim_ledger_writer');
        continue;
      }
      const x = parse(
        comment.body,
        marker,
        marker === CLAIMED ? LEDGER_FIELDS : CONSUMED_FIELDS
      );
      if (
        !x ||
        !safeId(x.requestCommentId) ||
        !safeId(x.runId) ||
        !sha(x.mainSha) ||
        !sha(x.candidateSha) ||
        ![
          'atomic-rollback-only-proof',
          'atomic-persistent-staging-cutover'
        ].includes(x.mode)
      ) {
        blockers.push('invalid_claim_or_consume_marker');
        continue;
      }
      const isProof =
        x.scope === ATOMIC_PROOF_SCOPE && x.mode === APPROVAL_MODES.proof;
      const isWrite =
        x.scope === ATOMIC_WRITE_SCOPE && x.mode === APPROVAL_MODES.persist;
      if (!isProof && !isWrite) blockers.push('unexpected_claimed_scope_mode');
      if (marker === CONSUMED && !TERMINAL_OUTCOMES.includes(x.result))
        blockers.push('invalid_consumed_outcome');
      if (comment.id <= x.requestCommentId)
        blockers.push('claim_or_consume_before_request');
      (marker === CLAIMED ? allClaims : allConsumed).push({
        ...x,
        auditCommentId: comment.id
      });
    }
  }
  const fingerprints = (x) =>
    [
      x.requestCommentId,
      x.operationId,
      x.scope,
      x.mode,
      x.mainSha,
      x.candidateSha,
      x.runId
    ].join('|');
  const claimedKeys = new Set(allClaims.map(fingerprints));
  const claimedPositions = new Map(
    allClaims.map((x) => [fingerprints(x), x.auditCommentId])
  );
  if (claimedKeys.size !== allClaims.length)
    blockers.push('duplicated_claim_record');
  if (new Set(allConsumed.map(fingerprints)).size !== allConsumed.length)
    blockers.push('duplicated_consumed_record');
  for (const c of allConsumed) {
    if (!claimedKeys.has(fingerprints(c))) {
      blockers.push('consumed_without_corresponding_claim');
    } else if (claimedPositions.get(fingerprints(c)) >= c.auditCommentId) {
      blockers.push('consumed_before_claim');
    }
  }
  if (
    req &&
    safeId(commentId) &&
    [...allClaims, ...allConsumed].some((x) => same(x, req, commentId))
  )
    blockers.push('already_claimed_or_consumed_request');
  // GitHub Issue comments are not an atomic compare-and-swap register.
  // Simultaneous jobs require an independent trusted-main concurrency fence
  // and post-write re-read before any secret is accessed.
  return result(
    blockers.length
      ? 'one_shot_ledger_hold'
      : 'unclaimed_request_hypothesis_only',
    {
      blockers: freeze([...new Set(blockers)]),
      historicalClaims: allClaims.length,
      historicalConsumed: allConsumed.length,
      observedPhase: blockers.length ? 'DENIED' : 'REQUEST_REVIEWED',
      claimNotYetWritten: true,
      claimCannotBeInferredFromThisReview: true,
      githubIssueCommentsAreNotAnAtomicCAS: true,
      requiresTrustedMainSerializedWriterAndPostWriteReread: true,
      oneShotReusedOnFailure: false
    }
  );
}

/**
 * Transition candidate only. NEVER posts a claim, reads secrets, or marks
 * an approval as consumed.
 */
export function quoteScoutAtomicClaimTransition({
  ledgerReview,
  requestReview,
  claimCommentId = null,
  claimPostObserved = false,
  claimReReadObserved = false,
  activeTrustedMainLock = false,
  stagingSecretsAlreadyRead = false,
  runnerCanceled = false
} = {}) {
  const blockers = [];
  if (ledgerReview?.status !== 'unclaimed_request_hypothesis_only')
    blockers.push('unclaimed_request_not_established');
  if (requestReview?.status !== 'canonical_request_reviewed_not_authenticated')
    blockers.push('owner_request_not_independently_authenticated');
  if (!activeTrustedMainLock)
    blockers.push('no_durable_serialized_owner_claim_lock');
  if (stagingSecretsAlreadyRead)
    blockers.push('staging_secret_accessed_before_claim');
  if (runnerCanceled) blockers.push('cancelled_request_cannot_be_retried');
  if (
    claimCommentId !== null &&
    (!safeId(claimCommentId) || !claimPostObserved || !claimReReadObserved)
  )
    blockers.push('claim_write_or_reread_unconfirmed');
  if ((claimPostObserved || claimReReadObserved) && claimCommentId === null)
    blockers.push('claim_evidence_without_comment_id');
  if (claimReReadObserved && !claimPostObserved)
    blockers.push('claim_reread_without_post_evidence');
  return result(
    blockers.length
      ? 'atomic_claim_boundary_hold'
      : 'claim_boundary_design_only',
    {
      blockers: freeze(blockers),
      candidatePhase: claimCommentId === null ? 'CLAIM_UNCONFIRMED' : 'CLAIMED',
      claimMustPrecedeAnySecrets: true,
      trueOneShotRequiresNewTrustedMainIssueWrite: true,
      noAutomaticRetryAfterClaim: true,
      claimCouldNotBeActuallyWritten: true,
      requiresFreshGithubCommentAfterClaim: true
    }
  );
}

/** All outcomes consume. A CLAIMED request can never be reused. */
export function quoteScoutAtomicConsumeTransition({
  requestReview,
  claimRecord,
  terminalOutcome,
  allPagesFetched = false,
  postCommitLedgerVerified = false
} = {}) {
  const blockers = [];
  const req = requestReview?.reviewedRequest;
  if (
    requestReview?.status !== 'canonical_request_reviewed_not_authenticated' ||
    !record(req)
  )
    blockers.push('request_not_reviewed');
  if (
    !record(claimRecord) ||
    !safeId(claimRecord.commentId) ||
    !safeId(claimRecord.requestCommentId) ||
    !safeId(claimRecord.runId) ||
    claimRecord.requestCommentId !== requestReview?.exactGithubCommentId ||
    claimRecord.scope !== req?.scope ||
    claimRecord.mode !== req?.mode ||
    claimRecord.operationId !== req?.operationId ||
    claimRecord.mainSha !== req?.mainSha ||
    claimRecord.candidateSha !== req?.candidateSha
  )
    blockers.push('claim_identity_or_sha_mismatch');
  if (!TERMINAL_OUTCOMES.includes(terminalOutcome))
    blockers.push('invalid_final_result');
  if (allPagesFetched !== true)
    blockers.push('fresh_github_history_not_verified');
  if (terminalOutcome === 'uncertain' && postCommitLedgerVerified !== true)
    blockers.push('ambiguous_commit_must_be_requeried_without_mutation');
  return result(
    blockers.length
      ? 'atomic_consumption_review_hold'
      : 'consumed_record_draft_only',
    {
      blockers: freeze(blockers),
      candidatePhase: 'CONSUMED',
      shouldConsumeRegardlessOfSuccess: true,
      neverRetrySameOwnerRequest: true,
      needsTrustedMainCommentWriteAndVerify: true,
      uncertainOutcomeMustNotReexecute: true,
      consumedMarkerWasNotPublished: true
    }
  );
}

/** Backup restoration is verified independently before Staging can run. */
export function quoteScoutAtomicRestoreProof({
  backupStatus,
  restoreStatus,
  backupDigest,
  restoredDigest,
  aclTriggerRlsParity = false,
  originalUnit = 'unknown',
  noNewValidEvents = false,
  commitStatus = 'unknown',
  writerFenceMaintained = false
} = {}) {
  const blockers = [];
  if (backupStatus !== 'complete_independently_verified')
    blockers.push('backup_not_verified');
  if (restoreStatus !== 'independent_restore_complete')
    blockers.push('restore_failed_or_unverified');
  if (
    typeof backupDigest !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(backupDigest) ||
    restoredDigest !== backupDigest
  )
    blockers.push('restored_full_rows_or_source_digest_mismatch');
  if (!aclTriggerRlsParity)
    blockers.push('function_acl_trigger_rls_parity_unproven');
  if (originalUnit !== '1pt_per_yen') blockers.push('unexpected_source_unit');
  if (!writerFenceMaintained) blockers.push('writer_fence_unverified');
  if (!['not_committed', 'committed', 'ambiguous'].includes(commitStatus))
    blockers.push('unknown_commit_resolution');
  if (commitStatus !== 'not_committed' && !noNewValidEvents)
    blockers.push('stale_backup_restore_would_erase_new_awards');
  if (commitStatus === 'ambiguous')
    blockers.push('ambiguous_commit_needs_independent_requery');
  return result(
    blockers.length
      ? 'restore_proof_hold'
      : 'restoration_evidence_self_reported_only',
    {
      blockers: freeze(blockers),
      backupWasReallyRestored: false,
      mayRestoreStaleBackup: false,
      mayResumePointWriters: false,
      requiresImmutableEventJournalAndFreshReadOnlyRequery: true
    }
  );
}
