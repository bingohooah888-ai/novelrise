// NOVELIGHT βScout Point10x — trusted-main CAS/fence handoff, OFFLINE ONLY.
// Does not read a secret, authenticate an OWNER, connect to PostgreSQL,
// perform a real atomic CAS, lock a writer, or authorize Staging/Production.
import {
  OWNER_LOGIN,
  ATOMIC_PROOF_SCOPE,
  ATOMIC_WRITE_SCOPE,
  APPROVAL_MODES,
  SOURCE_RPC_SHA256,
  FIXED_CANDIDATE_RPC_SHA256
} from './scout-point10x-atomic-staging-plan.mjs';
import {
  STAGING_PROJECT,
  MARKER_SQL_SHA256
} from './scout-point10x-atomic-execution-contract.mjs';
import { MUTATION_DOMAIN } from './scout-point10x-durable-fence-model.mjs';
import { RECOVERY_WRITER_CLASSES } from './scout-point10x-recovery-drain-model.mjs';

const obj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const pos = (x) => Number.isSafeInteger(x) && x > 0;
const hex40 = (x) => typeof x === 'string' && /^[a-f0-9]{40}$/u.test(x);
const hex64 = (x) => typeof x === 'string' && /^[a-f0-9]{64}$/u.test(x);
const frozen = (x) => Object.freeze(x);
export const TRUSTED_MAIN_HANDOFF_REQUIREMENTS = Object.freeze([
  'load_and_reverify_trusted_main_and_owner_event',
  'verify_exact_new_scope_mode_sha_target_issue_comment',
  'linearizable_one_transaction_spend_tombstone_and_epoch_claim',
  'hold_unknown_claim_ack_without_retry_or_secret_access',
  'record_github_claim_as_secondary_audit_not_authority',
  'lock_shared_mutation_domain_across_old_and_new_workflows',
  'deny_all_point_writers_at_data_plane_including_privileged_paths',
  'verify_nine_classes_drained_and_old_tokens_denied',
  'perform_independent_backup_restore_before_atomic_cutover',
  'never_resume_writers_on_unknown_commit_or_fence_loss'
]);
export const REQUIRED_PRIVILEGED_PATHS = Object.freeze([
  'legacy_security_definer_rpc',
  'direct_service_role_dml',
  'db_trigger_and_owner_roles',
  'edge_cron_queue_retry',
  'unregistered_future_writer'
]);
export const SINGLE_USE_CONSTRAINTS = Object.freeze([
  'UNIQUE(issue_number,comment_id)',
  'UNIQUE(operation_id)',
  'UNIQUE(scope,candidate_sha)',
  'UNIQUE(mutation_domain) WHERE active',
  'monotone_fencing_epoch_persisted_in_primary',
  'spent_tombstones_never_deleted_or_reset'
]);
export const UNSUPPORTED_REAL_ADAPTERS = Object.freeze([
  'no_trusted_main_deployed_runner',
  'no_durable_linearizable_cas_backend',
  'no_global_workflow_lock',
  'no_db_enforced_fence_for_service_role_and_old_rpc',
  'no_postgres_isolated_restore_proof',
  'no_real_issue294_owner_event_claim'
]);
function safe(status, journal, blockers = [], extra = {}) {
  return frozen({
    status,
    journal,
    blockers: frozen([...new Set(blockers)]),
    ...extra,
    evidenceLevel: 'offline_untrusted_fixture',
    canIssueApproval: false,
    canReadSecrets: false,
    canCreateGithubClaim: false,
    canCommitSql: false,
    canRunStaging: false,
    canWriteDb: false,
    canChangeProduction: false,
    canMergeMain: false,
    canDeploy: false,
    linearizableStoreConnected: false,
    dataPlaneFenceInstalled: false,
    trustedMainExecutorRunning: false,
    actualApprovalConsumed: false
  });
}
export function newOfflineCasJournal() {
  return frozen({
    domain: MUTATION_DOMAIN,
    version: 0,
    epoch: 0,
    active: null,
    spent: frozen([]),
    blockedWriters: frozen([]),
    ambiguous: false
  });
}
function isJournal(j) {
  return (
    obj(j) &&
    j.domain === MUTATION_DOMAIN &&
    Number.isSafeInteger(j.version) &&
    j.version >= 0 &&
    Number.isSafeInteger(j.epoch) &&
    j.epoch >= 0 &&
    (j.active === null || obj(j.active)) &&
    Array.isArray(j.spent) &&
    Array.isArray(j.blockedWriters) &&
    typeof j.ambiguous === 'boolean'
  );
}
function validReq(r) {
  return (
    obj(r) &&
    Object.keys(r).length === 10 &&
    hex40(r.mainSha) &&
    hex40(r.candidateSha) &&
    r.stagingRef === STAGING_PROJECT &&
    hex64(r.sourceSnapshotSha256) &&
    r.markerSqlSha256 === MARKER_SQL_SHA256 &&
    r.legacyRpcSha256 === SOURCE_RPC_SHA256 &&
    r.candidateRpcSha256 === FIXED_CANDIDATE_RPC_SHA256 &&
    typeof r.operationId === 'string' &&
    /^[a-z0-9][a-z0-9_-]{7,79}$/u.test(r.operationId) &&
    ((r.scope === ATOMIC_PROOF_SCOPE && r.mode === APPROVAL_MODES.proof) ||
      (r.scope === ATOMIC_WRITE_SCOPE && r.mode === APPROVAL_MODES.persist))
  );
}
function exactOwnerFixtures(e, req) {
  return (
    obj(e) &&
    e.authenticatedByTrustedMainInFixture === true &&
    e.owner === OWNER_LOGIN &&
    e.issueNumber === 294 &&
    e.issueTitle === '[Staging Control] Supabase migration sync' &&
    e.ownerEventIsFreshInFixture === true &&
    e.issueHistoryCompleteInFixture === true &&
    e.mainSha === req?.mainSha &&
    e.candidateSha === req?.candidateSha &&
    e.dedicatedStagingRef === STAGING_PROJECT &&
    e.primaryCasMayCommitInFixture === true &&
    e.secretsRead === false &&
    e.sharedDomainUncontendedInFixture === true
  );
}
/** Emulates ONE authoritative CAS, but does not persist it. */
export function simulateOfflineAtomicOwnerClaim({
  journal,
  request,
  commentId,
  runId,
  expectedVersion,
  expectedEpoch,
  ownerFixture
} = {}) {
  if (!isJournal(journal))
    return safe('HOLD_INVALID_OFFLINE_JOURNAL', journal, ['invalid_journal']);
  const blockers = [];
  if (!validReq(request)) blockers.push('invalid_or_replayed_scope_request');
  if (!pos(commentId) || !pos(runId)) blockers.push('invalid_comment_or_run');
  if (!exactOwnerFixtures(ownerFixture, request))
    blockers.push('not_authenticated_real_owner_evidence');
  if (journal.version !== expectedVersion || journal.epoch !== expectedEpoch)
    blockers.push('stale_version_or_epoch');
  if (journal.active !== null)
    blockers.push('another_claim_owns_shared_domain');
  if (journal.ambiguous) blockers.push('prior_commit_or_ack_ambiguous');
  if (
    validReq(request) &&
    journal.spent.some(
      (s) =>
        s.commentId === commentId ||
        s.operationId === request.operationId ||
        (s.scope === request.scope && s.candidateSha === request.candidateSha)
    )
  )
    blockers.push('already_spent_or_scope_head_reused');
  if (blockers.length) return safe('HOLD_OFFLINE_CAS', journal, blockers);
  const epoch = journal.epoch + 1;
  if (!pos(epoch)) return safe('HOLD_OFFLINE_CAS', journal, ['epoch_overflow']);
  const active = frozen({
    commentId,
    runId,
    epoch,
    operationId: request.operationId,
    mainSha: request.mainSha,
    candidateSha: request.candidateSha,
    scope: request.scope,
    mode: request.mode
  });
  const tombstone = frozen({
    commentId,
    operationId: request.operationId,
    scope: request.scope,
    candidateSha: request.candidateSha
  });
  return safe(
    'SYMBOLIC_CAS_SPENT_NOT_REAL',
    frozen({
      ...journal,
      version: journal.version + 1,
      epoch,
      active,
      spent: frozen([...journal.spent, tombstone])
    }),
    [],
    { hypotheticalEpoch: epoch, approvalStillNotAuthenticated: true }
  );
}
function matchActive(j, runId, epoch) {
  return (
    isJournal(j) &&
    pos(runId) &&
    pos(epoch) &&
    j.active?.runId === runId &&
    j.active?.epoch === epoch &&
    j.epoch === epoch
  );
}
export function simulateOfflineFenceAllWriters({
  journal,
  runId,
  epoch,
  writerEvidence,
  privilegedEvidence
} = {}) {
  const blockers = [];
  if (!matchActive(journal, runId, epoch))
    blockers.push('claim_or_epoch_mismatch');
  const kinds = Array.isArray(writerEvidence)
    ? writerEvidence.map((w) => w?.kind)
    : [];
  if (
    kinds.length !== RECOVERY_WRITER_CLASSES.length ||
    new Set(kinds).size !== kinds.length ||
    !RECOVERY_WRITER_CLASSES.every((k) => kinds.includes(k))
  )
    blockers.push('incomplete_writer_inventory');
  for (const kind of RECOVERY_WRITER_CLASSES) {
    const w = Array.isArray(writerEvidence)
      ? writerEvidence.find((x) => x?.kind === kind)
      : null;
    if (
      !obj(w) ||
      w.paused !== true ||
      w.admissionClosed !== true ||
      w.dataPlaneEpoch !== epoch ||
      w.oldTokenRejected !== true ||
      w.active !== 0 ||
      w.inflight !== 0 ||
      w.queued !== 0 ||
      w.retry !== 0 ||
      w.unacked !== 0 ||
      w.outbox !== 0
    )
      blockers.push('not_drained_or_fenced:' + kind);
  }
  const paths = Array.isArray(privilegedEvidence)
    ? privilegedEvidence.map((x) => x?.path)
    : [];
  if (
    paths.length !== REQUIRED_PRIVILEGED_PATHS.length ||
    new Set(paths).size !== paths.length ||
    !REQUIRED_PRIVILEGED_PATHS.every((p) => paths.includes(p))
  )
    blockers.push('privileged_writer_path_inventory_incomplete');
  for (const path of REQUIRED_PRIVILEGED_PATHS) {
    const record = Array.isArray(privilegedEvidence)
      ? privilegedEvidence.find((x) => x?.path === path)
      : null;
    if (
      !obj(record) ||
      record.dbEnforced === false ||
      record.dbEnforced !== true ||
      record.bypassImpossible !== true ||
      record.oldEpochRejected !== true
    )
      blockers.push('privileged_path_unfenced:' + path);
  }
  if (!isJournal(journal)) blockers.push('invalid_journal');
  if (blockers.length) return safe('HOLD_OFFLINE_FENCING', journal, blockers);
  return safe(
    'SYMBOLIC_ALL_FENCED_NOT_REAL',
    frozen({
      ...journal,
      version: journal.version + 1,
      blockedWriters: frozen([...RECOVERY_WRITER_CLASSES])
    }),
    [],
    { cannotTurnThisIntoRealDbGuard: true }
  );
}
/**
 * A read-only reviewer of writer admission. NO result permits a real write.
 * Fencing is required on the Data Plane, not just JS or GitHub concurrency.
 */
export function inspectOfflineWriterAttempt({
  journal,
  writerKind,
  runId,
  epoch,
  dbFenced,
  requiresBypass
} = {}) {
  const blockers = [];
  if (!RECOVERY_WRITER_CLASSES.includes(writerKind))
    blockers.push('unknown_writer_class');
  if (!matchActive(journal, runId, epoch))
    blockers.push('stale_or_unknown_fence_epoch');
  if (
    !Array.isArray(journal?.blockedWriters) ||
    journal.blockedWriters.length !== RECOVERY_WRITER_CLASSES.length
  )
    blockers.push('writer_fence_not_proven');
  if (dbFenced !== true) blockers.push('db_fence_unproven');
  if (requiresBypass === true) blockers.push('privileged_bypass_denied');
  if (journal?.ambiguous) blockers.push('uncertain_commit_hold');
  return safe('NO_WRITER_ADMISSION_OFFLINE', journal, blockers, {
    simulatedOldTokenWouldBeRejected: blockers.includes(
      'stale_or_unknown_fence_epoch'
    )
  });
}
export function simulateOfflineAmbiguousAck({ journal, runId, epoch } = {}) {
  if (!matchActive(journal, runId, epoch))
    return safe('HOLD_ACK_STATE_UNKNOWN', journal, ['claim_or_epoch_mismatch']);
  return safe(
    'HOLD_ACK_STATE_UNKNOWN',
    frozen({
      ...journal,
      ambiguous: true,
      version: journal.version + 1
    }),
    ['read_only_primary_cas_and_commit_journal_requery_required'],
    {
      noAutomatedReplay: true,
      noWriterResume: true,
      spentTombstoneRetained: true
    }
  );
}
export function inspectOfflineTrustedMainHandoff({
  mainPinned,
  ownerEventFromTrustedMain,
  primaryDurableCas,
  allLegacyAndNewWritersFenced,
  dataPlanePrivilegedBypassDenied,
  sourceBackupIndependentlyRestored,
  lockDomainShared,
  doNotAutoRetryUnknown
} = {}) {
  const gates = [
    ['trusted_main_not_verifiable', mainPinned],
    ['owner_event_unverified', ownerEventFromTrustedMain],
    ['durable_cas_backend_not_connected', primaryDurableCas],
    ['legacy_new_writers_not_jointly_fenced', allLegacyAndNewWritersFenced],
    ['privileged_data_plane_bypass_unproven', dataPlanePrivilegedBypassDenied],
    [
      'independent_backup_restore_not_proven',
      sourceBackupIndependentlyRestored
    ],
    ['cross_workflow_domain_not_shared', lockDomainShared],
    ['ambiguous_ack_replay_not_proven_safe', doNotAutoRetryUnknown]
  ];
  const blockers = gates.filter(([, v]) => v !== true).map(([key]) => key);
  return safe('HANDOFF_DESIGN_ONLY_NOT_LIVE_READY', null, blockers, {
    assertedGates: frozen(
      gates.map(([key, v]) => frozen({ key, asserted: v === true }))
    ),
    realProofCanOnlyComeFromSeparatelyApprovedInfrastructure: true
  });
}
