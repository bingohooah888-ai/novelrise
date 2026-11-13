// NOVELIGHT Point10x: deterministic OFFLINE model of a future durable-CAS gate.
// NO persistence, GitHub access, secrets, network, SQL, lock acquisition or execution.
// All outputs deny operational authority even when the symbolic CAS succeeds.
import {
  OWNER_LOGIN,
  ATOMIC_PROOF_SCOPE,
  ATOMIC_WRITE_SCOPE,
  APPROVAL_MODES,
  REQUEST_FIELDS,
  SOURCE_RPC_SHA256,
  FIXED_CANDIDATE_RPC_SHA256
} from './scout-point10x-atomic-staging-plan.mjs';
import {
  STAGING_PROJECT,
  MARKER_SQL_SHA256
} from './scout-point10x-atomic-execution-contract.mjs';

export const MUTATION_DOMAIN = 'issue294-point10x-all-staging-writers';
export const TERMINAL = Object.freeze([
  'success',
  'failure',
  'cancelled',
  'interrupted',
  'uncertain'
]);
const sha40 = (x) => typeof x === 'string' && /^[a-f0-9]{40}$/u.test(x);
const sha64 = (x) => typeof x === 'string' && /^[a-f0-9]{64}$/u.test(x);
const positive = (x) => Number.isSafeInteger(x) && x > 0;
const dict = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const frozen = (x) => Object.freeze(x);
const noAuthority = (status, store, blockers = [], more = {}) =>
  frozen({
    status,
    blockers: frozen([...new Set(blockers)]),
    store,
    ...more,
    symbolicOnly: true,
    ownerAuthenticatedInReality: false,
    durableStoreConnected: false,
    compareAndSwapActuallyExecuted: false,
    fenceActuallyAcquired: false,
    mayReadStagingSecrets: false,
    mayWriteStaging: false,
    mayPostGitHubLedger: false,
    mayExecuteSql: false,
    mayChangeProduction: false,
    mayMergeMain: false,
    mayDeploy: false
  });

export function createScoutPoint10xSymbolicStore() {
  return frozen({
    version: 0,
    fencingEpoch: 0,
    active: null,
    spent: frozen([]),
    domain: MUTATION_DOMAIN
  });
}
const validStore = (s) =>
  dict(s) &&
  s.domain === MUTATION_DOMAIN &&
  Number.isSafeInteger(s.version) &&
  s.version >= 0 &&
  Number.isSafeInteger(s.fencingEpoch) &&
  s.fencingEpoch >= 0 &&
  (s.active === null || dict(s.active)) &&
  Array.isArray(s.spent) &&
  s.spent.every(
    (x) =>
      dict(x) &&
      positive(x.requestCommentId) &&
      typeof x.operationId === 'string' &&
      sha40(x.candidateSha) &&
      typeof x.scope === 'string'
  );

const validRequest = (req) => {
  if (
    !dict(req) ||
    Object.keys(req).length !== REQUEST_FIELDS.length ||
    !REQUEST_FIELDS.every((k) => Object.hasOwn(req, k)) ||
    !sha40(req.mainSha) ||
    !sha40(req.candidateSha) ||
    !sha64(req.sourceSnapshotSha256) ||
    req.stagingRef !== STAGING_PROJECT ||
    req.markerSqlSha256 !== MARKER_SQL_SHA256 ||
    req.legacyRpcSha256 !== SOURCE_RPC_SHA256 ||
    req.candidateRpcSha256 !== FIXED_CANDIDATE_RPC_SHA256 ||
    typeof req.operationId !== 'string' ||
    !/^[a-z0-9][a-z0-9_-]{7,79}$/u.test(req.operationId)
  )
    return false;
  return (
    (req.scope === ATOMIC_PROOF_SCOPE && req.mode === APPROVAL_MODES.proof) ||
    (req.scope === ATOMIC_WRITE_SCOPE && req.mode === APPROVAL_MODES.persist)
  );
};

const matchesActive = (a, req, requestCommentId, runId, token) =>
  dict(a) &&
  a.requestCommentId === requestCommentId &&
  a.operationId === req.operationId &&
  a.mainSha === req.mainSha &&
  a.candidateSha === req.candidateSha &&
  a.scope === req.scope &&
  a.mode === req.mode &&
  a.runId === runId &&
  a.fencingEpoch === token;

const used = (store, req, requestCommentId) =>
  store.spent.some(
    (x) =>
      x.requestCommentId === requestCommentId ||
      x.operationId === req.operationId ||
      (x.scope === req.scope && x.candidateSha === req.candidateSha)
  );

/**
 * A symbolic CAS commits a spent approval and the exclusive lease together.
 * It must later be implemented as ONE durable linearizable transaction with
 * unique keys and a monotonic persisted fencing token. Boolean evidence below
 * is a TEST FIXTURE, never GitHub authentication.
 */
export function modelScoutPoint10xDurableClaim({
  store,
  request,
  requestCommentId,
  runId,
  expectedVersion,
  expectedEpoch,
  evidence = {}
} = {}) {
  const blockers = [];
  if (!validStore(store))
    return noAuthority('CLAIM_REFUSED', store, ['invalid_store_snapshot']);
  if (!validRequest(request)) blockers.push('invalid_pinned_request');
  if (!positive(requestCommentId) || !positive(runId))
    blockers.push('invalid_comment_or_run');
  if (expectedVersion !== store.version || expectedEpoch !== store.fencingEpoch)
    blockers.push('stale_cas_revision_or_fence');
  if (store.active !== null) blockers.push('mutation_domain_already_claimed');
  if (
    validRequest(request) &&
    positive(requestCommentId) &&
    used(store, request, requestCommentId)
  )
    blockers.push('approval_replay_or_scope_head_reuse');
  if (
    evidence.owner !== OWNER_LOGIN ||
    evidence.issue !== 294 ||
    evidence.ownerEventVerified !== true ||
    evidence.trustedMainLoaded !== true ||
    evidence.allIssueHistoryVerified !== true ||
    evidence.exclusiveDomainLockVerified !== true ||
    evidence.candidateDraftVerified !== true ||
    evidence.stagingRefVerified !== true
  )
    blockers.push('untrusted_or_incomplete_claim_evidence');
  if (
    !validRequest(request) ||
    evidence.freshMainSha !== request.mainSha ||
    evidence.freshCandidateSha !== request.candidateSha
  )
    blockers.push('fresh_main_or_head_mismatch');
  if (evidence.stagingSecretsAlreadyRead === true)
    blockers.push('secret_access_before_durable_claim');
  if (blockers.length) return noAuthority('CLAIM_REFUSED', store, blockers);
  const fencingEpoch = store.fencingEpoch + 1;
  const claim = frozen({
    requestCommentId,
    operationId: request.operationId,
    scope: request.scope,
    mode: request.mode,
    mainSha: request.mainSha,
    candidateSha: request.candidateSha,
    runId,
    fencingEpoch,
    phase: 'CLAIMED',
    outcome: null
  });
  const next = frozen({
    ...store,
    version: store.version + 1,
    fencingEpoch,
    active: claim,
    spent: frozen([
      ...store.spent,
      frozen({
        requestCommentId,
        operationId: request.operationId,
        scope: request.scope,
        candidateSha: request.candidateSha
      })
    ])
  });
  return noAuthority('SYMBOLIC_CAS_COMMITTED_NOT_REAL', next, [], {
    hypotheticalFencingToken: fencingEpoch,
    requestWasSymbolicallySpent: true,
    githubClaimStillUnverified: true,
    doNotAccessSecretsFromThisResult: true
  });
}

/**
 * Loss of an acknowledgement AFTER a committed CAS cannot make an approval
 * unspent. GitHub CLAIMED/CONSUMED are secondary audit, not primary authority.
 */
export function modelScoutPoint10xConsume({
  store,
  request,
  requestCommentId,
  runId,
  token,
  expectedVersion,
  outcome,
  evidence = {}
} = {}) {
  if (!validStore(store))
    return noAuthority('CONSUME_REFUSED', store, ['invalid_store_snapshot']);
  const blockers = [];
  if (
    !validRequest(request) ||
    !matchesActive(store.active, request, requestCommentId, runId, token)
  )
    blockers.push('claim_or_fence_token_mismatch');
  if (store.active?.phase !== 'CLAIMED')
    blockers.push('no_live_claim_to_consume');
  if (expectedVersion !== store.version)
    blockers.push('stale_consume_cas_revision');
  if (!TERMINAL.includes(outcome))
    blockers.push('unsupported_terminal_outcome');
  if (evidence.githubClaimReReadVerified !== true)
    blockers.push('github_claim_reread_not_proven');
  if (
    outcome === 'uncertain' &&
    evidence.readOnlyCommitRequeryVerified !== true
  )
    blockers.push('ambiguous_commit_needs_readonly_requery');
  if (blockers.length) return noAuthority('CONSUME_REFUSED', store, blockers);
  const next = frozen({
    ...store,
    version: store.version + 1,
    active: frozen({ ...store.active, phase: 'CONSUMED', outcome })
  });
  return noAuthority('SYMBOLIC_CONSUMED_NOT_REAL', next, [], {
    approvalPermanentlySpent: true,
    githubConsumedCommentStillUnverified: true,
    reuseDeniedEvenOnFailure: true
  });
}

export function modelScoutPoint10xReconcile({
  store,
  request,
  requestCommentId,
  runId,
  token,
  expectedVersion,
  evidence = {}
} = {}) {
  if (!validStore(store))
    return noAuthority('RECONCILE_REFUSED', store, ['invalid_store_snapshot']);
  const blockers = [];
  if (
    !validRequest(request) ||
    !matchesActive(store.active, request, requestCommentId, runId, token) ||
    store.active?.phase !== 'CONSUMED'
  )
    blockers.push('consumed_claim_identity_or_fence_not_proven');
  if (expectedVersion !== store.version)
    blockers.push('stale_reconciliation_revision');
  if (
    evidence.githubConsumedReReadVerified !== true ||
    evidence.durableAuditVerified !== true ||
    evidence.writerFenceStillHeld !== true ||
    evidence.independentRowReconciliation !== true ||
    evidence.cleanupVerified !== true
  )
    blockers.push('audit_or_recovery_evidence_incomplete');
  if (
    store.active?.outcome === 'uncertain' ||
    evidence.commitState === 'unknown' ||
    evidence.commitState === 'ambiguous'
  )
    blockers.push('unknown_commit_must_remain_fenced');
  if (evidence.newValidPointAwards === true)
    blockers.push('stale_backup_may_erase_valid_points');
  if (
    evidence.commitState !== 'not_committed' ||
    evidence.restoreVerification !== 'independent_complete'
  )
    blockers.push('safe_precommit_restore_not_verified');
  if (blockers.length) return noAuthority('RECONCILE_REFUSED', store, blockers);
  return noAuthority(
    'SYMBOLIC_RELEASE_NOT_REAL',
    frozen({ ...store, version: store.version + 1, active: null }),
    [],
    { spentTombstonesRetained: true, nextClaimNeedsNewApproval: true }
  );
}

export const CRASH_BOUNDARIES = Object.freeze([
  'before_cas_response_unknown',
  'after_cas_ack_lost',
  'after_cas_before_github_claim',
  'after_github_claim_before_reread',
  'after_consume_ack_lost',
  'restore_failed',
  'commit_unknown'
]);

/** Crash/fault annotations never mint a retry or assume an unspent claim. */
export function modelScoutPoint10xCrashBoundary({ store, boundary } = {}) {
  if (!validStore(store) || !CRASH_BOUNDARIES.includes(boundary))
    return noAuthority('CRASH_MODEL_REFUSED', store, ['invalid_crash_input']);
  return noAuthority(
    'CRASH_HOLD_MANUAL_REQUERY',
    store,
    [
      'do_not_reuse_approval_after_ambiguous_ack',
      'read_only_primary_and_audit_requery_required',
      'new_owner_approval_for_new_attempt_required'
    ],
    {
      faultBoundary: boundary,
      approvalMayHaveBeenSpent: true,
      spentRecordExistsInModel: store.spent.length > 0,
      doNotRetry: true,
      doNotReleaseWriterFence: true
    }
  );
}

/** Exhaustive 20 order-preserving schedules, two runners x 3 operations. */
export function exploreScoutPoint10xSymbolicCasRace({
  request,
  evidence
} = {}) {
  if (!validRequest(request))
    return noAuthority('RACE_MODEL_REFUSED', null, ['invalid_pinned_request']);
  let schedules = 0;
  let doubleAccepted = 0;
  let schedulesWithRejection = 0;
  const traverse = (positions, snapshots, store, accepted, rejected) => {
    if (positions[0] === 3 && positions[1] === 3) {
      schedules += 1;
      if (accepted > 1) doubleAccepted += 1;
      if (rejected > 0) schedulesWithRejection += 1;
      return;
    }
    for (const runner of [0, 1]) {
      if (positions[runner] >= 3) continue;
      const nextPositions = [...positions];
      const nextSnapshots = [...snapshots];
      const step = positions[runner];
      nextPositions[runner]++;
      let nextStore = store;
      let nextAccepted = accepted;
      let nextRejected = rejected;
      if (step === 0)
        nextSnapshots[runner] = frozen({
          expectedVersion: store.version,
          expectedEpoch: store.fencingEpoch
        });
      if (step === 1) {
        const candidate = modelScoutPoint10xDurableClaim({
          store,
          request,
          requestCommentId: 9001,
          runId: runner + 101,
          ...nextSnapshots[runner],
          evidence
        });
        if (candidate.status === 'SYMBOLIC_CAS_COMMITTED_NOT_REAL') {
          nextAccepted++;
          nextStore = candidate.store;
        } else nextRejected++;
      }
      traverse(
        nextPositions,
        nextSnapshots,
        nextStore,
        nextAccepted,
        nextRejected
      );
    }
  };
  traverse([0, 0], [null, null], createScoutPoint10xSymbolicStore(), 0, 0);
  return noAuthority('OFFLINE_CAS_RACE_MODEL_ONLY', null, [], {
    schedules,
    doubleAccepted,
    schedulesWithRejection,
    requiresRealLinearizableStoreAndWriterFence: true
  });
}
