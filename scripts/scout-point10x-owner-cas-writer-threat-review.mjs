// NOVELIGHT beta Scout Point10x: OFFLINE threat-model contracts ONLY.
// No trusted adapter, GitHub call, PostgreSQL connection, SQL execution, or approval.
// Caller-provided evidence and symbolic successes NEVER confer operational authority.
import {
  OWNER_LOGIN,
  REPO,
  ISSUE_TITLE
} from './scout-point10x-atomic-staging-plan.mjs';
import { STAGING_PROJECT } from './scout-point10x-atomic-execution-contract.mjs';
import { OWNER_CONTROL_ISSUE } from './scout-point10x-catalog-readonly-review.mjs';
import {
  makeInertSnapshotManifest,
  SNAPSHOT_PLAN_SCOPE,
  SNAPSHOT_TXN_BOUNDARY,
  REQUIRED_FAIL_CLOSED,
  reviewSnapshotOwnerClaimContract
} from './scout-point10x-single-snapshot-review.mjs';
import { MUTATION_DOMAIN } from './scout-point10x-durable-fence-model.mjs';
import {
  REQUIRED_PRIVILEGED_PATHS,
  SINGLE_USE_CONSTRAINTS
} from './scout-point10x-cas-fencing-handoff-model.mjs';
import { SCOUT_POINT_10X_WRITER_CLASSES } from '../api/_lib/reader-reward/point-tenfold-writer-cutover-contract.js';

export const THREAT_MODEL_PROTOCOL = 'POINT10X_SOURCE_ONLY_THREAT_REVIEW_V1';
export const PROVENANCE_PROTOCOL = 'POINT10X_SYNTHETIC_OWNER_EVENT_V1';
export const CAS_PROTOCOL = 'POINT10X_SYNTHETIC_CONTROL_CAS_V1';
export const FENCE_PROTOCOL = 'POINT10X_SYNTHETIC_DATA_PLANE_FENCE_V1';
export const EXPECTED_CAS_PARTS = Object.freeze([
  'verify_current_unspent_unique_keys',
  'insert_irrevocable_spent_tombstone',
  'advance_monotone_fencing_epoch',
  'create_exclusive_mutation_domain_claim'
]);
export const OWNER_PROVENANCE_REQUIREMENTS = Object.freeze([
  'trusted_main_reads_issue_294_from_authenticated_github_api',
  'verify_comment_author_id_repo_issue_and_event_origin',
  'recheck_exact_main_sha_pr_head_scope_sql_hashes_plan_digest',
  'verify_unedited_not_expired_unique_one_time_comment',
  'all_pages_history_and_claim_consumed_conflicts_checked',
  'independently_verify_owner_will_not_be_impersonated_by_fixture'
]);
export const FENCE_REQUIRED_CLASSES = Object.freeze([
  ...SCOUT_POINT_10X_WRITER_CLASSES
]);
export const FENCE_REQUIRED_PRIVILEGED_PATHS = Object.freeze([
  ...REQUIRED_PRIVILEGED_PATHS
]);
const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, ks) =>
  object(x) &&
  Object.keys(x).length === ks.length &&
  ks.every((k) => Object.hasOwn(x, k));
const listExact = (x, expected) =>
  Array.isArray(x) &&
  x.length === expected.length &&
  x.every((v, i) => v === expected[i]);
const hex = (v, n) =>
  typeof v === 'string' && new RegExp('^[0-9a-f]{' + n + '}$', 'u').test(v);
const positive = (x) => Number.isSafeInteger(x) && x > 0;
const nonnegative = (x) => Number.isSafeInteger(x) && x >= 0;
const freeze = (x) => Object.freeze(x);
const uniq = (x) => freeze([...new Set(x)]);
const manifest = () => makeInertSnapshotManifest();
const noAuthority = freeze({
  proofType: 'UNTRUSTED_SYNTHETIC_SOURCE_ONLY',
  decision: 'NO_GO',
  authenticatedOwner: false,
  ownerApprovalRegistered: false,
  actualControlClaimed: false,
  actualSpentConsumed: false,
  actualWriterFenced: false,
  writerDrainRealVerified: false,
  singleRealSnapshotVerified: false,
  actualCatalogCompared: false,
  realSqlExecuted: false,
  realDatabaseConnections: 0,
  mayIssueApproval: false,
  mayClaimOwner: false,
  mayWriteIssue294: false,
  mayConnectDb: false,
  mayReadSecrets: false,
  mayRunSql: false,
  mayWriteDb: false,
  mayUseDocker: false,
  mayRunStaging: false,
  mayChangeProduction: false,
  mayMergeMain: false,
  mayDeploy: false,
  mayRetryAutomatically: false,
  mayReleaseFence: false,
  mayResumeWriters: false
});
function conclusion(area, problems, extra = {}) {
  const causes = uniq(problems);
  return freeze({
    status: causes.length ? 'HOLD_INERT_' + area : 'NO_GO_INERT_' + area,
    blockers: uniq([
      ...REQUIRED_FAIL_CLOSED,
      'NEW_OWNER_SINGLE_SNAPSHOT_SCOPE_UNREGISTERED_UNAPPROVED',
      'NO_TRUSTED_GITHUB_CONTROL_POSTGRES_OR_DATA_PLANE_PROOF',
      ...causes
    ]),
    modelInvariantPass: causes.length === 0,
    syntheticEvidenceOnly: true,
    partialEvidenceDiscarded: causes.length > 0,
    ...extra,
    ...noAuthority
  });
}
function canonicalRequest(id = 735001) {
  const m = manifest();
  return {
    scope: SNAPSHOT_PLAN_SCOPE,
    operation: 'read-catalog-11-same-snapshot',
    issueNumber: OWNER_CONTROL_ISSUE,
    stagingRef: STAGING_PROJECT,
    mainSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    planDigest: m.planDigest,
    originalSqlDigests: { ...SNAPSHOT_TXN_BOUNDARY.originalSqlDigests },
    commentId: id
  };
}
export function makeGoodOwnerProvenanceFixture() {
  const request = canonicalRequest();
  return {
    protocol: PROVENANCE_PROTOCOL,
    source: 'SYNTHETIC_NOT_GITHUB',
    event: {
      commentId: request.commentId,
      author: OWNER_LOGIN,
      authorType: 'User',
      repo: REPO,
      issueNumber: OWNER_CONTROL_ISSUE,
      issueTitle: ISSUE_TITLE,
      eventKind: 'issue_comment',
      eventOrigin: 'fixture-only',
      edited: false,
      deleted: false,
      isBotOrDelegate: false,
      createdAt: '2026-11-05T00:00:00Z',
      expiresAt: '2026-11-06T00:00:00Z',
      observedAt: '2026-11-05T01:00:00Z',
      signatureStatus: 'NOT_AUTHENTICATED_IN_MODEL',
      approvalMarker: 'PROPOSED_NOT_POSTED'
    },
    request,
    fresh: {
      mainSha: request.mainSha,
      headSha: request.headSha,
      planDigest: request.planDigest,
      stagingRef: request.stagingRef,
      issueNumber: OWNER_CONTROL_ISSUE,
      draftPrNumber: 2762
    },
    history: {
      kind: 'SYNTHETIC_COMPLETE_PAGES_NOT_PROOF',
      paginationCompleteInFixture: true,
      duplicateIds: [],
      claimedIds: [],
      consumedIds: [],
      unknownMarkers: [],
      competingScopeHeadIds: [],
      requestSeenOnce: true
    }
  };
}
export function reviewInertOwnerProvenance({ fixture } = {}) {
  const errors = [];
  if (!object(fixture) || fixture.protocol !== PROVENANCE_PROTOCOL)
    return conclusion('OWNER_PROVENANCE', [
      'OWNER_PROVENANCE_PROTOCOL_REQUIRED'
    ]);
  if (
    !exact(fixture, [
      'protocol',
      'source',
      'event',
      'request',
      'fresh',
      'history'
    ]) ||
    fixture.source !== 'SYNTHETIC_NOT_GITHUB'
  )
    errors.push('OWNER_EVENT_INPUT_OR_ORIGIN_UNTRUSTED');
  const e = fixture.event,
    r = fixture.request,
    f = fixture.fresh,
    h = fixture.history;
  if (
    !exact(e, [
      'commentId',
      'author',
      'authorType',
      'repo',
      'issueNumber',
      'issueTitle',
      'eventKind',
      'eventOrigin',
      'edited',
      'deleted',
      'isBotOrDelegate',
      'createdAt',
      'expiresAt',
      'observedAt',
      'signatureStatus',
      'approvalMarker'
    ]) ||
    e.author !== OWNER_LOGIN ||
    e.authorType !== 'User' ||
    e.repo !== REPO ||
    e.issueNumber !== OWNER_CONTROL_ISSUE ||
    e.issueTitle !== ISSUE_TITLE ||
    e.eventKind !== 'issue_comment' ||
    e.eventOrigin !== 'fixture-only' ||
    e.signatureStatus !== 'NOT_AUTHENTICATED_IN_MODEL' ||
    e.approvalMarker !== 'PROPOSED_NOT_POSTED' ||
    e.isBotOrDelegate !== false ||
    !positive(e.commentId)
  )
    errors.push('FORGED_OWNER_ACTOR_REPO_OR_EVENT_ORIGIN');
  if (
    e?.edited !== false ||
    e?.deleted !== false ||
    !Number.isFinite(Date.parse(e?.createdAt)) ||
    !Number.isFinite(Date.parse(e?.expiresAt)) ||
    !Number.isFinite(Date.parse(e?.observedAt)) ||
    Date.parse(e.createdAt) > Date.parse(e.observedAt) ||
    Date.parse(e.observedAt) >= Date.parse(e.expiresAt)
  )
    errors.push('STALE_EDITED_DELETED_OR_EXPIRED_OWNER_EVENT');
  const checked = reviewSnapshotOwnerClaimContract({
    request: r,
    manifest: manifest()
  });
  if (
    !object(r) ||
    checked.blockers.length !== REQUIRED_FAIL_CLOSED.length ||
    r.commentId !== e?.commentId
  )
    errors.push('OWNER_REQUEST_NOT_EXACTLY_SCOPE_BOUND');
  if (
    !exact(f, [
      'mainSha',
      'headSha',
      'planDigest',
      'stagingRef',
      'issueNumber',
      'draftPrNumber'
    ]) ||
    !hex(f.mainSha, 40) ||
    !hex(f.headSha, 40) ||
    f.mainSha !== r?.mainSha ||
    f.headSha !== r?.headSha ||
    f.planDigest !== r?.planDigest ||
    f.stagingRef !== STAGING_PROJECT ||
    f.issueNumber !== OWNER_CONTROL_ISSUE ||
    f.draftPrNumber !== 2762
  )
    errors.push('OWNER_FRESH_MAIN_HEAD_OR_TARGET_MISMATCH');
  if (
    !exact(h, [
      'kind',
      'paginationCompleteInFixture',
      'duplicateIds',
      'claimedIds',
      'consumedIds',
      'unknownMarkers',
      'competingScopeHeadIds',
      'requestSeenOnce'
    ]) ||
    h.kind !== 'SYNTHETIC_COMPLETE_PAGES_NOT_PROOF' ||
    h.paginationCompleteInFixture !== true ||
    h.requestSeenOnce !== true ||
    ![
      h.duplicateIds,
      h.claimedIds,
      h.consumedIds,
      h.unknownMarkers,
      h.competingScopeHeadIds
    ].every((a) => Array.isArray(a) && a.length === 0)
  )
    errors.push('ISSUE_HISTORY_REPLAY_OR_UNKNOWN_EVENT');
  return conclusion('OWNER_PROVENANCE', errors, {
    ownerAuthenticationStillRequired: true,
    syntheticRequestWasNeverIssued: true
  });
}

export function makeGoodCasThreatFixture() {
  const r = canonicalRequest();
  return {
    protocol: CAS_PROTOCOL,
    storage: 'NO_PERSISTENCE_MODEL',
    request: {
      commentId: r.commentId,
      operationId: 'fixture-point10x-run01',
      scope: r.scope,
      mainSha: r.mainSha,
      headSha: r.headSha
    },
    observed: {
      domain: MUTATION_DOMAIN,
      version: 8,
      epoch: 12,
      active: null,
      spentComments: [],
      spentOperations: [],
      spentScopeHeads: [],
      commitUncertain: false
    },
    proposal: {
      expectedVersion: 8,
      expectedEpoch: 12,
      nextVersion: 9,
      nextEpoch: 13,
      mutationDomain: MUTATION_DOMAIN,
      transaction: 'SINGLE_SYMBOLIC_ATOMIC',
      isolation: 'SERIALIZABLE_REQUIRED',
      parts: [...EXPECTED_CAS_PARTS],
      uniqueConstraints: [...SINGLE_USE_CONSTRAINTS],
      tombstone: 'IRREVOCABLE_IN_MODEL',
      claimedOneTime: true,
      commitAck: 'received',
      attempt: 1,
      retryOnUnknown: false,
      unlockWriters: false,
      readback: 'NOT_PERFORMED_IN_MODEL'
    }
  };
}
export function reviewInertCasThreat({ fixture } = {}) {
  const errs = [];
  if (!object(fixture) || fixture.protocol !== CAS_PROTOCOL)
    return conclusion('CONTROL_CAS', ['CONTROL_CAS_PROTOCOL_REQUIRED']);
  if (
    !exact(fixture, [
      'protocol',
      'storage',
      'request',
      'observed',
      'proposal'
    ]) ||
    fixture.storage !== 'NO_PERSISTENCE_MODEL'
  )
    errs.push('CALLER_SIMULATION_CANNOT_ASSERT_DURABLE_STORAGE');
  const r = fixture.request,
    s = fixture.observed,
    p = fixture.proposal;
  if (
    !exact(r, ['commentId', 'operationId', 'scope', 'mainSha', 'headSha']) ||
    !positive(r.commentId) ||
    !/^[a-z0-9][a-z0-9_-]{7,79}$/u.test(String(r.operationId)) ||
    r.scope !== SNAPSHOT_PLAN_SCOPE ||
    !hex(r.mainSha, 40) ||
    !hex(r.headSha, 40)
  )
    errs.push('CAS_REQUEST_ID_SCOPE_OR_SHA_INVALID');
  if (
    !exact(s, [
      'domain',
      'version',
      'epoch',
      'active',
      'spentComments',
      'spentOperations',
      'spentScopeHeads',
      'commitUncertain'
    ]) ||
    s.domain !== MUTATION_DOMAIN ||
    !nonnegative(s.version) ||
    !nonnegative(s.epoch) ||
    s.active !== null ||
    s.commitUncertain !== false ||
    ![s.spentComments, s.spentOperations, s.spentScopeHeads].every(
      Array.isArray
    )
  )
    errs.push('CAS_PRIMARY_SNAPSHOT_UNSAFE_OR_AMBIGUOUS');
  if (
    (Array.isArray(s?.spentComments) &&
      s.spentComments.includes(r?.commentId)) ||
    (Array.isArray(s?.spentOperations) &&
      s.spentOperations.includes(r?.operationId)) ||
    (Array.isArray(s?.spentScopeHeads) &&
      s.spentScopeHeads.includes(r?.scope + '@' + r?.headSha))
  )
    errs.push('CAS_ALREADY_SPENT_OR_DUPLICATE_SCOPE_HEAD');
  if (
    !exact(p, [
      'expectedVersion',
      'expectedEpoch',
      'nextVersion',
      'nextEpoch',
      'mutationDomain',
      'transaction',
      'isolation',
      'parts',
      'uniqueConstraints',
      'tombstone',
      'claimedOneTime',
      'commitAck',
      'attempt',
      'retryOnUnknown',
      'unlockWriters',
      'readback'
    ]) ||
    p.mutationDomain !== MUTATION_DOMAIN ||
    p.transaction !== 'SINGLE_SYMBOLIC_ATOMIC' ||
    p.isolation !== 'SERIALIZABLE_REQUIRED' ||
    !listExact(p.parts, EXPECTED_CAS_PARTS) ||
    !listExact(p.uniqueConstraints, SINGLE_USE_CONSTRAINTS) ||
    p.tombstone !== 'IRREVOCABLE_IN_MODEL' ||
    p.claimedOneTime !== true ||
    p.readback !== 'NOT_PERFORMED_IN_MODEL' ||
    p.unlockWriters !== false
  )
    errs.push('CAS_ATOMIC_SPENT_EPOCH_OR_UNIQUE_KEYS_NOT_MODELLED');
  if (
    p?.expectedVersion !== s?.version ||
    p?.expectedEpoch !== s?.epoch ||
    !nonnegative(s?.version) ||
    !nonnegative(s?.epoch) ||
    p?.nextVersion !== s.version + 1 ||
    p?.nextEpoch !== s.epoch + 1 ||
    !Number.isSafeInteger(p?.nextVersion) ||
    !Number.isSafeInteger(p?.nextEpoch)
  )
    errs.push('CAS_STALE_REVISION_EPOCH_OR_OVERFLOW');
  if (p?.commitAck !== 'received' || s?.commitUncertain === true)
    errs.push('CAS_COMMIT_AMBIGUOUS_MUST_HOLD_READBACK');
  if (p?.attempt !== 1 || p?.retryOnUnknown !== false)
    errs.push('CAS_RETRY_OR_SECOND_ATTEMPT_FORBIDDEN');
  return conclusion('CONTROL_CAS', errs, {
    symbolicClaimCouldBeConsistent: errs.length === 0,
    actuallyLinearizable: false,
    durableTombstoneExists: false,
    authoritativeReadbackRequired: errs.includes(
      'CAS_COMMIT_AMBIGUOUS_MUST_HOLD_READBACK'
    )
  });
}
export function modelInertCasRace({ state, contenders = [] } = {}) {
  const errors = [];
  if (
    !object(state) ||
    state.domain !== MUTATION_DOMAIN ||
    !nonnegative(state.version) ||
    !nonnegative(state.epoch) ||
    state.active !== null ||
    !Array.isArray(state.spent) ||
    state.uncertain !== false
  )
    errors.push('RACE_STATE_NOT_CLEAN');
  if (
    !Array.isArray(contenders) ||
    contenders.length !== 2 ||
    contenders.some(
      (c) =>
        !object(c) ||
        !positive(c.commentId) ||
        typeof c.operationId !== 'string' ||
        !hex(c.headSha, 40) ||
        c.expectedVersion !== state?.version ||
        c.expectedEpoch !== state?.epoch
    )
  )
    errors.push('TWO_VALID_SAME_REVISION_CONTENDERS_REQUIRED');
  if (
    Array.isArray(contenders) &&
    contenders.length === 2 &&
    (contenders[0]?.commentId === contenders[1]?.commentId ||
      contenders[0]?.operationId === contenders[1]?.operationId)
  )
    errors.push('DUPLICATE_CONTENDER_IDENTITY');
  if (
    Array.isArray(state?.spent) &&
    contenders.some(
      (c) =>
        state.spent.includes(c?.commentId) ||
        state.spent.includes(c?.operationId)
    )
  )
    errors.push('SPENT_CONTENDER_REPLAY');
  return conclusion('CAS_RACE', errors, {
    hypotheticalWinnerCount: errors.length ? 0 : 1,
    hypotheticalRejectedConcurrentCount: errors.length ? 2 : 1,
    noRealSerializabilityProof: true
  });
}
export function makeGoodFenceThreatFixture() {
  return {
    protocol: FENCE_PROTOCOL,
    source: 'SYNTHETIC_NOT_DB',
    control: {
      domain: MUTATION_DOMAIN,
      epoch: 13,
      priorEpoch: 12,
      writeLease: 'SINGLE_SYMBOLIC_OWNER',
      commitAck: 'received',
      writerReleaseAllowed: false
    },
    writers: SCOUT_POINT_10X_WRITER_CLASSES.map((kind) => ({
      kind,
      observedEpoch: 13,
      oldEpochDeniedInFixture: true,
      pending: 0,
      queued: 0,
      unacknowledged: 0,
      blockedInFixture: true
    })),
    privileged: REQUIRED_PRIVILEGED_PATHS.map((kind) => ({
      kind,
      blockedInFixture: true,
      canBypass: false,
      aclVerifiedLive: false
    })),
    unknownWriters: [],
    externalControls: {
      role: 'UNDEPLOYED_READONLY_MODEL',
      legacySecurityDefinerRevokedLive: false,
      serviceRoleDmlDeniedLive: false,
      triggerBypassClosedLive: false,
      ddlSuperuserBypassClosedLive: false,
      queueDrainVerifiedLive: false,
      backupRestoreVerifiedLive: false
    }
  };
}
export function reviewInertWriterFenceThreat({ fixture } = {}) {
  const errs = [];
  if (!object(fixture) || fixture.protocol !== FENCE_PROTOCOL)
    return conclusion('DATA_PLANE_FENCE', ['WRITER_FENCE_PROTOCOL_REQUIRED']);
  if (
    !exact(fixture, [
      'protocol',
      'source',
      'control',
      'writers',
      'privileged',
      'unknownWriters',
      'externalControls'
    ]) ||
    fixture.source !== 'SYNTHETIC_NOT_DB'
  )
    errs.push('UNTRUSTED_FENCE_SOURCE_OR_EXTRA_FIELDS');
  const c = fixture.control;
  if (
    !exact(c, [
      'domain',
      'epoch',
      'priorEpoch',
      'writeLease',
      'commitAck',
      'writerReleaseAllowed'
    ]) ||
    c.domain !== MUTATION_DOMAIN ||
    !positive(c.epoch) ||
    !nonnegative(c.priorEpoch) ||
    c.epoch !== c.priorEpoch + 1 ||
    c.writeLease !== 'SINGLE_SYMBOLIC_OWNER' ||
    c.commitAck !== 'received' ||
    c.writerReleaseAllowed !== false
  )
    errs.push('FENCE_EPOCH_LEASE_OR_COMMIT_UNSAFE');
  const w = fixture.writers;
  if (
    !Array.isArray(w) ||
    w.length !== SCOUT_POINT_10X_WRITER_CLASSES.length ||
    w.some(
      (item, i) =>
        !exact(item, [
          'kind',
          'observedEpoch',
          'oldEpochDeniedInFixture',
          'pending',
          'queued',
          'unacknowledged',
          'blockedInFixture'
        ]) ||
        item.kind !== SCOUT_POINT_10X_WRITER_CLASSES[i] ||
        item.observedEpoch !== c?.epoch ||
        item.oldEpochDeniedInFixture !== true ||
        ![item.pending, item.queued, item.unacknowledged].every(
          (x) => x === 0
        ) ||
        item.blockedInFixture !== true
    )
  )
    errs.push('NINE_WRITER_CLASSES_NOT_FENCED_AND_DRAINED');
  const p = fixture.privileged;
  if (
    !Array.isArray(p) ||
    p.length !== REQUIRED_PRIVILEGED_PATHS.length ||
    p.some(
      (item, i) =>
        !exact(item, [
          'kind',
          'blockedInFixture',
          'canBypass',
          'aclVerifiedLive'
        ]) ||
        item.kind !== REQUIRED_PRIVILEGED_PATHS[i] ||
        item.blockedInFixture !== true ||
        item.canBypass !== false ||
        item.aclVerifiedLive !== false
    )
  )
    errs.push('FIVE_PRIVILEGED_PATHS_NOT_FENCED');
  if (!Array.isArray(fixture.unknownWriters) || fixture.unknownWriters.length)
    errs.push('UNKNOWN_OR_FUTURE_WRITER_PATH_UNRESOLVED');
  const x = fixture.externalControls;
  if (
    !exact(x, [
      'role',
      'legacySecurityDefinerRevokedLive',
      'serviceRoleDmlDeniedLive',
      'triggerBypassClosedLive',
      'ddlSuperuserBypassClosedLive',
      'queueDrainVerifiedLive',
      'backupRestoreVerifiedLive'
    ]) ||
    x.role !== 'UNDEPLOYED_READONLY_MODEL' ||
    Object.entries(x).some(([k, v]) => k !== 'role' && v !== false)
  )
    errs.push('UNTRUSTED_LIVE_FENCE_OR_BACKUP_ASSERTION');
  return conclusion('DATA_PLANE_FENCE', errs, {
    nineSyntheticClassesCovered: errs.length === 0,
    fiveSyntheticPrivilegedPathsCovered: errs.length === 0,
    actualDbAclRevocationVerified: false,
    realQueueDrainVerified: false
  });
}
export function reviewCombinedInertThreats({ owner, cas, fence } = {}) {
  const a = reviewInertOwnerProvenance({ fixture: owner });
  const b = reviewInertCasThreat({ fixture: cas });
  const c = reviewInertWriterFenceThreat({ fixture: fence });
  const errors = [];
  if (!a.modelInvariantPass) errors.push('OWNER_PROVENANCE_INVALID');
  if (!b.modelInvariantPass) errors.push('CONTROL_CAS_INVALID');
  if (!c.modelInvariantPass) errors.push('DATA_PLANE_FENCE_INVALID');
  if (
    !object(owner) ||
    !object(cas) ||
    !object(fence) ||
    owner.request?.commentId !== cas.request?.commentId ||
    owner.request?.mainSha !== cas.request?.mainSha ||
    owner.request?.headSha !== cas.request?.headSha ||
    owner.request?.scope !== cas.request?.scope
  )
    errors.push('OWNER_CONTROL_CLAIM_BINDING_DISJOINT');
  if (
    cas?.proposal?.nextEpoch !== fence?.control?.epoch ||
    cas?.observed?.epoch !== fence?.control?.priorEpoch ||
    cas?.observed?.domain !== fence?.control?.domain
  )
    errors.push('CONTROL_FENCE_EPOCH_DOMAIN_SPLIT');
  return conclusion('COMBINED', errors, {
    subsystems: freeze({ owner: a.status, cas: b.status, fence: c.status }),
    fullSyntheticInvariantPass: errors.length === 0,
    realCutoverReady: false
  });
}
