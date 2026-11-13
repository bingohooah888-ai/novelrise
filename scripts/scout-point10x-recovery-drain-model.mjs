// NOVELIGHT beta Scout Point10x: pure OFFLINE recovery / drain review model.
// No external I/O, DB/SQL, Secrets, GitHub mutation, writer control or restore.
// Caller-provided evidence is untrusted and NEVER grants execution authority.
import { SCOUT_POINT_10X_WRITER_CLASSES } from '../api/_lib/reader-reward/point-tenfold-writer-cutover-contract.js';
import {
  STAGING_PROJECT,
  PRODUCTION_PROJECT,
  WRITER_DB_RELATIONS
} from './scout-point10x-atomic-execution-contract.mjs';
import { MUTATION_DOMAIN } from './scout-point10x-durable-fence-model.mjs';
import {
  ATOMIC_PROOF_SCOPE,
  ATOMIC_WRITE_SCOPE,
  APPROVAL_MODES
} from './scout-point10x-atomic-staging-plan.mjs';

export const RECOVERY_WRITER_CLASSES = Object.freeze([
  ...SCOUT_POINT_10X_WRITER_CLASSES
]);
export const RECOVERY_RELATIONS = Object.freeze([...WRITER_DB_RELATIONS]);
export const RECOVERY_COMMIT_STATES = Object.freeze([
  'not_committed',
  'committed',
  'unknown',
  'ambiguous'
]);
export const RECOVERY_OPERATIONS = Object.freeze([
  'read_only_backup_metadata_review',
  'read_only_independent_restore_evidence_review',
  'read_only_writer_drain_evidence_review',
  'read_only_commit_marker_journal_review',
  'manual_owner_decision_required'
]);

const isObject = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const nonnegative = (v) => Number.isSafeInteger(v) && v >= 0;
const positive = (v) => Number.isSafeInteger(v) && v > 0;
const hex40 = (v) => typeof v === 'string' && /^[0-9a-f]{40}$/u.test(v);
const hex64 = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/u.test(v);
const bad = (blockers, condition, reason) => {
  if (!condition) blockers.push(reason);
};
const output = (status, blockers, details = {}) =>
  Object.freeze({
    status,
    blockers: Object.freeze([...new Set(blockers)]),
    ...details,
    proofMode: 'untrusted_offline_fixture',
    actualWriterStopped: false,
    actualBackupRestored: false,
    actualCommitStateVerified: false,
    actualDbFenceVerified: false,
    realStagingTestCompleted: false,
    ownerApprovedOperation: false,
    mayReadSecrets: false,
    mayPauseRealWriters: false,
    mayRunStaging: false,
    mayWriteDb: false,
    mayRestoreDb: false,
    mayResumeWriters: false,
    mayPostGithubLedger: false,
    mayChangeProduction: false,
    mayMergeMain: false,
    mayDeploy: false
  });

function reviewClaim(store, request, requestCommentId, runId, token) {
  const blockers = [];
  bad(
    blockers,
    isObject(store) && store.domain === MUTATION_DOMAIN,
    'missing_symbolic_domain'
  );
  const a = isObject(store?.active) ? store.active : null;
  bad(
    blockers,
    a !== null && ['CLAIMED', 'CONSUMED'].includes(a.phase),
    'missing_symbolic_active_claim'
  );
  bad(blockers, isObject(request), 'request_not_a_record');
  if (isObject(request)) {
    bad(
      blockers,
      hex40(request.mainSha) && hex40(request.candidateSha),
      'invalid_pinned_main_or_candidate_sha'
    );
    bad(
      blockers,
      request.stagingRef === STAGING_PROJECT,
      'not_dedicated_staging_project'
    );
    bad(
      blockers,
      (request.scope === ATOMIC_PROOF_SCOPE &&
        request.mode === APPROVAL_MODES.proof) ||
        (request.scope === ATOMIC_WRITE_SCOPE &&
          request.mode === APPROVAL_MODES.persist),
      'wrong_scope_or_mode'
    );
  }
  bad(
    blockers,
    positive(requestCommentId) && positive(runId) && positive(token),
    'invalid_claim_identifiers'
  );
  bad(
    blockers,
    a !== null &&
      a.requestCommentId === requestCommentId &&
      a.runId === runId &&
      a.fencingEpoch === token &&
      a.scope === request?.scope &&
      a.mode === request?.mode &&
      a.mainSha === request?.mainSha &&
      a.candidateSha === request?.candidateSha &&
      a.operationId === request?.operationId &&
      store?.fencingEpoch === token,
    'claim_identity_or_fencing_mismatch'
  );
  bad(
    blockers,
    Array.isArray(store?.spent) &&
      store.spent.some(
        (x) =>
          x?.requestCommentId === requestCommentId &&
          x?.operationId === request?.operationId &&
          x?.candidateSha === request?.candidateSha &&
          x?.scope === request?.scope
      ),
    'approval_spend_tombstone_missing'
  );
  return blockers;
}

export function reviewScoutPoint10xDrain({
  store,
  request,
  requestCommentId,
  runId,
  token,
  writers,
  fence
} = {}) {
  const blockers = reviewClaim(store, request, requestCommentId, runId, token);
  if (
    !Array.isArray(writers) ||
    writers.length !== RECOVERY_WRITER_CLASSES.length
  )
    blockers.push('writer_roster_count_mismatch');
  const kinds = Array.isArray(writers) ? writers.map((w) => w?.kind) : [];
  bad(
    blockers,
    kinds.length === new Set(kinds).size &&
      RECOVERY_WRITER_CLASSES.every((kind) => kinds.includes(kind)),
    'writer_roster_missing_duplicate_or_unknown'
  );
  for (const kind of RECOVERY_WRITER_CLASSES) {
    const w = Array.isArray(writers)
      ? writers.find((x) => x?.kind === kind)
      : null;
    if (!isObject(w)) continue;
    if (
      w.pauseRequested !== true ||
      w.pauseConfirmed !== true ||
      w.admissionClosed !== true
    )
      blockers.push('writer_pause_unverified:' + kind);
    for (const field of [
      'active',
      'inflight',
      'queued',
      'unacked',
      'retry',
      'outbox'
    ]) {
      if (!nonnegative(w[field]) || w[field] !== 0)
        blockers.push('writer_not_drained:' + kind + ':' + field);
    }
    if (
      w.fencingEpoch !== token ||
      w.dataPlaneFenced !== true ||
      w.oldTokenRejected !== true
    )
      blockers.push('writer_fence_unverified:' + kind);
  }
  bad(blockers, isObject(fence), 'fence_evidence_missing');
  if (isObject(fence)) {
    bad(
      blockers,
      fence.mutationDomain === MUTATION_DOMAIN &&
        fence.fencingEpoch === token &&
        fence.runId === runId,
      'shared_domain_fence_identity_mismatch'
    );
    for (const field of [
      'dbAdvisoryOrEquivalentLockHeld',
      'allOldAndNewWritersFencedAtDataPlane',
      'legacySecurityDefinerWritesDenied',
      'directServiceRoleWritesDenied',
      'queuedEdgeCronAndRetriesRejected',
      'noNewValidAwardsSincePause',
      'independentReadOnlyProbes'
    ])
      bad(blockers, fence[field] === true, 'fence_unverified:' + field);
    bad(
      blockers,
      Array.isArray(fence.samples) &&
        fence.samples.length === 2 &&
        fence.samples.every(
          (s) =>
            isObject(s) &&
            positive(s.tick) &&
            nonnegative(s.sequence) &&
            hex64(s.fullRowDigest)
        ) &&
        fence.samples[0].tick < fence.samples[1].tick &&
        fence.samples[0].sequence === fence.samples[1].sequence &&
        fence.samples[0].fullRowDigest === fence.samples[1].fullRowDigest,
      'stable_independent_drain_watermark_not_proven'
    );
  }
  return output(
    blockers.length
      ? 'HOLD_WRITER_DRAIN_UNPROVEN'
      : 'MODEL_DRAIN_PREREQUISITES_ONLY',
    blockers,
    {
      requiredWriterClasses: RECOVERY_WRITER_CLASSES.length,
      actualDrainObservationCount: 0,
      hypotheticalChecksSatisfied: blockers.length === 0
    }
  );
}

export function reviewScoutPoint10xIndependentBackup({
  request,
  token,
  backup,
  restore,
  lockedSnapshot
} = {}) {
  const blockers = [];
  bad(
    blockers,
    isObject(request) && request.stagingRef === STAGING_PROJECT,
    'backup_wrong_staging_context'
  );
  bad(blockers, isObject(backup), 'backup_manifest_missing');
  bad(blockers, isObject(restore), 'independent_restore_evidence_missing');
  bad(blockers, isObject(lockedSnapshot), 'locked_snapshot_missing');
  if (isObject(backup)) {
    bad(
      blockers,
      backup.sourceProjectRef === STAGING_PROJECT &&
        backup.sourceProjectRef !== PRODUCTION_PROJECT,
      'backup_wrong_source_project'
    );
    bad(
      blockers,
      typeof backup.sourceInstanceId === 'string' &&
        backup.sourceInstanceId.length >= 8,
      'backup_source_instance_unidentified'
    );
    bad(
      blockers,
      hex64(backup.objectSha256) &&
        hex64(backup.manifestSha256) &&
        hex64(backup.fullRowDigest) &&
        hex64(backup.schemaDigest) &&
        hex64(backup.functionAclTriggerDigest),
      'backup_digest_missing_or_invalid'
    );
    bad(
      blockers,
      nonnegative(backup.snapshotSequence),
      'backup_watermark_invalid'
    );
    bad(
      blockers,
      backup.immutableObject === true &&
        backup.completeDatabaseDump === true &&
        backup.includesPointXpAndEventJournals === true &&
        backup.checksumVerified === true,
      'full_immutable_backup_unverified'
    );
  }
  if (isObject(restore)) {
    bad(
      blockers,
      restore.isolated === true &&
        restore.outboundAccessDisabled === true &&
        restore.realRestoreCompleted === true &&
        restore.independentVerifier === true,
      'isolated_restore_not_proven'
    );
    bad(
      blockers,
      typeof restore.instanceId === 'string' &&
        restore.instanceId.length >= 8 &&
        restore.instanceId !== backup?.sourceInstanceId &&
        restore.projectRef !== STAGING_PROJECT &&
        restore.projectRef !== PRODUCTION_PROJECT,
      'restore_not_independent_of_staging_production'
    );
    bad(
      blockers,
      restore.restoredObjectSha256 === backup?.objectSha256 &&
        hex64(restore.restoredObjectSha256),
      'restored_object_checksum_mismatch'
    );
    bad(
      blockers,
      restore.fullRowDigest === backup?.fullRowDigest &&
        restore.schemaDigest === backup?.schemaDigest &&
        restore.functionAclTriggerDigest === backup?.functionAclTriggerDigest,
      'independent_restore_fingerprint_mismatch'
    );
    bad(
      blockers,
      restore.snapshotSequence === backup?.snapshotSequence,
      'restore_watermark_mismatch'
    );
  }
  if (isObject(lockedSnapshot)) {
    bad(
      blockers,
      lockedSnapshot.fencingEpoch === token &&
        positive(lockedSnapshot.fencingEpoch),
      'locked_snapshot_fencing_mismatch'
    );
    bad(
      blockers,
      lockedSnapshot.sequence === backup?.snapshotSequence &&
        nonnegative(lockedSnapshot.sequence),
      'backup_does_not_match_locked_source_watermark'
    );
    bad(
      blockers,
      lockedSnapshot.fullRowDigest === backup?.fullRowDigest &&
        lockedSnapshot.schemaDigest === backup?.schemaDigest &&
        lockedSnapshot.functionAclTriggerDigest ===
          backup?.functionAclTriggerDigest,
      'locked_source_vs_backup_snapshot_mismatch'
    );
    bad(
      blockers,
      lockedSnapshot.writerFenceStillHeld === true &&
        lockedSnapshot.independentReadOnlyObservation === true,
      'locked_snapshot_not_independently_observed'
    );
  }
  // Whole-row reconciliation must cover every relation; aggregate hashes alone
  // cannot detect omission of an XP, award, reversal, or operator relation.
  for (const source of ['backup', 'restore', 'lockedSnapshot']) {
    const record = { backup, restore, lockedSnapshot }[source];
    const tableDigests = record?.tableDigests;
    bad(
      blockers,
      isObject(tableDigests) &&
        Object.keys(tableDigests).length === RECOVERY_RELATIONS.length &&
        RECOVERY_RELATIONS.every((k) => hex64(tableDigests[k])),
      'missing_full_relation_digests:' + source
    );
  }
  if (
    isObject(backup?.tableDigests) &&
    isObject(restore?.tableDigests) &&
    isObject(lockedSnapshot?.tableDigests)
  ) {
    for (const name of RECOVERY_RELATIONS) {
      if (
        backup.tableDigests[name] !== restore.tableDigests[name] ||
        backup.tableDigests[name] !== lockedSnapshot.tableDigests[name]
      )
        blockers.push('relation_digest_drift:' + name);
    }
  }
  return output(
    blockers.length
      ? 'HOLD_BACKUP_RESTORE_UNPROVEN'
      : 'MODEL_INDEPENDENT_BACKUP_PREREQUISITES_ONLY',
    blockers,
    {
      requiredRelations: Object.freeze([...RECOVERY_RELATIONS]),
      hypotheticalChecksSatisfied: blockers.length === 0
    }
  );
}

export function reviewScoutPoint10xRecoveryDecision({
  store,
  request,
  requestCommentId,
  runId,
  token,
  writers,
  fence,
  backup,
  restore,
  lockedSnapshot,
  commit
} = {}) {
  const drain = reviewScoutPoint10xDrain({
    store,
    request,
    requestCommentId,
    runId,
    token,
    writers,
    fence
  });
  const copy = reviewScoutPoint10xIndependentBackup({
    request,
    token,
    backup,
    restore,
    lockedSnapshot
  });
  const blockers = [...drain.blockers, ...copy.blockers];
  bad(
    blockers,
    Array.isArray(fence?.samples) &&
      fence.samples.length === 2 &&
      fence.samples.every(
        (s) =>
          s?.sequence === lockedSnapshot?.sequence &&
          s?.fullRowDigest === lockedSnapshot?.fullRowDigest
      ),
    'drain_observation_does_not_match_locked_source'
  );
  bad(blockers, isObject(commit), 'commit_resolution_missing');
  if (isObject(commit)) {
    bad(
      blockers,
      RECOVERY_COMMIT_STATES.includes(commit.state),
      'commit_state_invalid'
    );
    bad(
      blockers,
      commit.fencingEpoch === token &&
        commit.runId === runId &&
        commit.mutationDomain === MUTATION_DOMAIN,
      'commit_journal_fencing_identity_mismatch'
    );
    bad(
      blockers,
      commit.readOnlyMarkerVerified === true &&
        commit.readOnlyLedgerVerified === true &&
        commit.readOnlyEventJournalVerified === true &&
        commit.independentSourceObserved === true,
      'commit_state_read_only_requery_incomplete'
    );
    bad(
      blockers,
      commit.currentSourceSequence === lockedSnapshot?.sequence &&
        commit.currentSourceFullRowDigest === lockedSnapshot?.fullRowDigest &&
        nonnegative(commit.currentSourceSequence) &&
        hex64(commit.currentSourceFullRowDigest),
      'pre_restore_source_snapshot_drift'
    );
    bad(
      blockers,
      nonnegative(commit.validAwardsAfterSnapshot) &&
        nonnegative(commit.validReversalsAfterSnapshot) &&
        nonnegative(commit.validXpEventsAfterSnapshot) &&
        nonnegative(commit.externalSideEffectsAfterSnapshot),
      'post_snapshot_event_counts_missing'
    );
    if (
      commit.validAwardsAfterSnapshot !== 0 ||
      commit.validReversalsAfterSnapshot !== 0 ||
      commit.validXpEventsAfterSnapshot !== 0 ||
      commit.externalSideEffectsAfterSnapshot !== 0
    )
      blockers.push(
        'stale_backup_would_erase_valid_events_or_external_effects'
      );
    if (commit.state !== 'not_committed')
      blockers.push(
        commit.state === 'committed'
          ? 'already_committed_forward_repair_only'
          : 'ambiguous_commit_hold_manual_requery'
      );
    bad(
      blockers,
      commit.markerAbsent === true &&
        commit.cutoverJournalAbsent === true &&
        commit.postSnapshotPointLedgerUnchanged === true,
      'cutover_marker_or_ledger_changed'
    );
    bad(
      blockers,
      commit.writerFenceStillHeld === true &&
        commit.manualOwnerRestoreApproval === true,
      'restore_owner_and_writer_fence_review_missing'
    );
  }
  const unique = [...new Set(blockers)];
  const mode =
    isObject(commit) && commit.state === 'committed'
      ? 'FORWARD_REPAIR_MANUAL_REVIEW_ONLY'
      : isObject(commit) && ['unknown', 'ambiguous'].includes(commit.state)
        ? 'HOLD_AMBIGUOUS_COMMIT'
        : unique.includes(
              'stale_backup_would_erase_valid_events_or_external_effects'
            )
          ? 'HOLD_LEGITIMATE_POINT_LOSS_RISK'
          : unique.length
            ? 'HOLD_RECOVERY_UNPROVEN'
            : 'MODEL_MANUAL_RESTORE_ELIGIBILITY_ONLY';
  return output(mode, unique, {
    drainStatus: drain.status,
    independentBackupStatus: copy.status,
    noAutomaticRestoreEvenIfAllFixtureFlagsTrue: true,
    manualReviewRequired: true,
    forwardRepairInsteadOfStaleRestore:
      mode === 'FORWARD_REPAIR_MANUAL_REVIEW_ONLY',
    safeNextSteps: RECOVERY_OPERATIONS
  });
}
