// NOVELIGHT Point10x: OFFLINE contract review for a FUTURE trusted read-only executor.
// This module is not an executor. No database, GitHub, CONTROL, auth, or SQL adapter exists here.
import { createHash } from 'node:crypto';
import {
  makeInertSnapshotManifest,
  reviewSnapshotOwnerClaimContract,
  SNAPSHOT_PLAN_SCOPE,
  SNAPSHOT_TXN_BOUNDARY,
  SINGLE_SNAPSHOT_IDS,
  REQUIRED_FAIL_CLOSED
} from './scout-point10x-single-snapshot-review.mjs';
import {
  makeGoodOfflineFixture,
  replayOfflineElevenSelects
} from './scout-point10x-offline-orchestration-mock.mjs';
import { OWNER_CONTROL_ISSUE } from './scout-point10x-catalog-readonly-review.mjs';
import { STAGING_PROJECT } from './scout-point10x-atomic-execution-contract.mjs';
import { MUTATION_DOMAIN } from './scout-point10x-durable-fence-model.mjs';

export const TRUST_REVIEW_PROTOCOL = 'POINT10X_INERT_TRUST_BOUNDARY_V1';
export const EVIDENCE_REVIEW_PROTOCOL = 'POINT10X_INERT_AUDIT_ENVELOPE_V1';
export const RECOVERY_REVIEW_PROTOCOL = 'POINT10X_INERT_RECOVERY_V1';
export const RECOVERY_STEPS = Object.freeze([
  'MODEL_REQUEST',
  'MODEL_CONTROL_CAS',
  'MODEL_OPEN',
  'MODEL_READONLY_BEGIN',
  'MODEL_ELEVEN_SELECTS',
  'MODEL_ROLLBACK_ACK',
  'MODEL_CLOSE_ACK',
  'MODEL_SEALED_EVIDENCE'
]);
export const RECOVERY_FAILURES = Object.freeze([
  'STALE_OWNER_SCOPE',
  'CAS_CONFLICT',
  'CAS_STALE_EPOCH',
  'CONTROL_COMMIT_UNKNOWN',
  'OPEN_TIMEOUT',
  'CONNECTION_LOST',
  'SELECT_TIMEOUT',
  'SELECT_FAILED',
  'SPLIT_SNAPSHOT',
  'ROLLBACK_ACK_UNKNOWN',
  'CLOSE_ACK_UNKNOWN',
  'EVIDENCE_STORE_UNKNOWN',
  'UNKNOWN_PRIVILEGED_PATH'
]);
const frozen = (x) => Object.freeze(x);
const record = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const hex = (s, n) =>
  typeof s === 'string' && new RegExp('^[0-9a-f]{' + n + '}$', 'u').test(s);
const hash = (s) => createHash('sha256').update(s).digest('hex');
const unique = (a) => frozen([...new Set(a)]);
const expectedManifest = () => makeInertSnapshotManifest();
const acceptableKeys = (v, allowed) =>
  record(v) && Object.keys(v).every((k) => allowed.includes(k));
const noLivePowers = frozen({
  mayConnectDb: false,
  mayRunSql: false,
  mayWriteDb: false,
  mayClaimOwner: false,
  mayUseDocker: false,
  mayRunStaging: false,
  mayChangeProduction: false,
  mayMergeMain: false,
  mayDeploy: false,
  authenticatedOwner: false,
  actualControlClaimed: false,
  actualSpentConsumed: false,
  singleRealSnapshotVerified: false,
  realPrivilegedWriterFenced: false,
  realSqlExecuted: false,
  actualCatalogCompared: false,
  actualBackupRestored: false,
  realDatabaseConnections: 0
});
function verdict(errors, kind, summary = {}) {
  const issues = unique(errors);
  return frozen({
    status: issues.length ? 'HOLD_INERT_' + kind : 'NO_GO_INERT_' + kind,
    decision: 'NO_GO',
    syntheticInvariantPass: issues.length === 0,
    blockers: unique([
      ...REQUIRED_FAIL_CLOSED,
      'TRUSTED_EXECUTOR_NOT_IMPLEMENTED',
      'UNTRUSTED_MODEL_DIGEST_IS_NOT_AUTHENTICATION',
      ...issues
    ]),
    sanitized: true,
    partialResultsDiscarded: issues.length !== 0,
    noAutomaticRetry: true,
    noAutomaticOwnerClaim: true,
    ...summary,
    ...noLivePowers
  });
}
const approvedRequestShape = (manifest) => ({
  scope: SNAPSHOT_PLAN_SCOPE,
  operation: 'read-catalog-11-same-snapshot',
  issueNumber: OWNER_CONTROL_ISSUE,
  stagingRef: STAGING_PROJECT,
  mainSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  planDigest: manifest.planDigest,
  originalSqlDigests: { ...SNAPSHOT_TXN_BOUNDARY.originalSqlDigests },
  commentId: 456789
});

export function makeGoodBoundaryFixture() {
  const manifest = expectedManifest();
  return {
    protocol: TRUST_REVIEW_PROTOCOL,
    expected: {
      mainSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      planDigest: manifest.planDigest
    },
    owner: {
      kind: 'SYNTHETIC_UNAPPROVED',
      request: approvedRequestShape(manifest),
      ownerAuthenticated: false,
      commentConsumed: false
    },
    control: {
      kind: 'CONTROL_CONTRACT_NOT_DEPLOYED',
      domain: MUTATION_DOMAIN,
      version: 1,
      epoch: 5,
      spentDurable: false,
      writerFenceActive: false,
      commitAck: 'received'
    },
    session: {
      kind: 'SYNTHETIC_NO_CONNECTION',
      dbRef: STAGING_PROJECT,
      physicalConnections: 1,
      role: 'DEDICATED_METADATA_READONLY_REQUIRED',
      privilege: 'CATALOG_SELECT_ONLY_REQUIRED',
      isolation: 'REPEATABLE READ',
      access: 'READ ONLY',
      begin: SNAPSHOT_TXN_BOUNDARY.transactionBegin,
      termination: 'ROLLBACK',
      poolRebinding: false,
      secretMaterialPresent: false
    },
    pinned: {
      originalSqlDigests: { ...SNAPSHOT_TXN_BOUNDARY.originalSqlDigests },
      planDigest: manifest.planDigest,
      statementDigests: manifest.statements.map((s) => s.queryDigest),
      statementIds: [...SINGLE_SNAPSHOT_IDS]
    },
    outputs: {
      mode: 'SANITIZED_DIGESTS_ONLY',
      unknownPrivilegedPaths: [],
      rawRowDataPresent: false,
      secretPresent: false,
      snapshotProof: 'SYNTHETIC_NOT_REAL'
    }
  };
}

export function reviewInertExecutorBoundary({ fixture } = {}) {
  const e = [],
    m = expectedManifest();
  if (!record(fixture) || fixture.protocol !== TRUST_REVIEW_PROTOCOL)
    return verdict(['BOUNDARY_PROTOCOL_INVALID'], 'EXECUTOR_BOUNDARY');
  if (
    !acceptableKeys(fixture, [
      'protocol',
      'expected',
      'owner',
      'control',
      'session',
      'pinned',
      'outputs'
    ])
  )
    e.push('UNEXPECTED_EXECUTOR_INPUT_FIELDS');
  if (
    !record(fixture.expected) ||
    !hex(fixture.expected.mainSha, 40) ||
    !hex(fixture.expected.headSha, 40) ||
    fixture.expected.planDigest !== m.planDigest
  )
    e.push('EXPECTED_SHA_AND_MANIFEST_BINDING_INVALID');
  const o = fixture.owner,
    r = o?.request;
  if (
    !record(o) ||
    o.kind !== 'SYNTHETIC_UNAPPROVED' ||
    o.ownerAuthenticated !== false ||
    o.commentConsumed !== false ||
    !acceptableKeys(o, [
      'kind',
      'request',
      'ownerAuthenticated',
      'commentConsumed'
    ])
  )
    e.push('UNTRUSTED_OWNER_CANNOT_ASSERT_APPROVAL');
  if (
    !record(r) ||
    reviewSnapshotOwnerClaimContract({ request: r, manifest: m }).blockers
      .length !== REQUIRED_FAIL_CLOSED.length
  )
    e.push('OWNER_SCOPE_OR_PINNED_REQUEST_INVALID');
  if (
    r?.mainSha !== fixture.expected?.mainSha ||
    r?.headSha !== fixture.expected?.headSha
  )
    e.push('OWNER_MAIN_HEAD_STALE_OR_UNBOUND');
  const c = fixture.control;
  if (
    !record(c) ||
    c.kind !== 'CONTROL_CONTRACT_NOT_DEPLOYED' ||
    c.domain !== MUTATION_DOMAIN ||
    !Number.isSafeInteger(c.version) ||
    c.version < 0 ||
    !Number.isSafeInteger(c.epoch) ||
    c.epoch < 0 ||
    c.spentDurable !== false ||
    c.writerFenceActive !== false ||
    c.commitAck !== 'received' ||
    !acceptableKeys(c, [
      'kind',
      'domain',
      'version',
      'epoch',
      'spentDurable',
      'writerFenceActive',
      'commitAck'
    ])
  )
    e.push('CONTROL_PLANE_NOT_SAFE_FOR_OFFLINE_REVIEW');
  const s = fixture.session;
  if (
    !record(s) ||
    s.kind !== 'SYNTHETIC_NO_CONNECTION' ||
    s.dbRef !== STAGING_PROJECT ||
    s.physicalConnections !== 1 ||
    s.role !== 'DEDICATED_METADATA_READONLY_REQUIRED' ||
    s.privilege !== 'CATALOG_SELECT_ONLY_REQUIRED' ||
    s.isolation !== 'REPEATABLE READ' ||
    s.access !== 'READ ONLY' ||
    s.begin !== SNAPSHOT_TXN_BOUNDARY.transactionBegin ||
    s.termination !== 'ROLLBACK' ||
    s.poolRebinding !== false ||
    s.secretMaterialPresent !== false ||
    !acceptableKeys(s, [
      'kind',
      'dbRef',
      'physicalConnections',
      'role',
      'privilege',
      'isolation',
      'access',
      'begin',
      'termination',
      'poolRebinding',
      'secretMaterialPresent'
    ])
  )
    e.push('SINGLE_READONLY_SESSION_LEAST_PRIVILEGE_NOT_MODELLED');
  const p = fixture.pinned;
  if (
    !record(p) ||
    p.planDigest !== m.planDigest ||
    p.originalSqlDigests?.base !==
      SNAPSHOT_TXN_BOUNDARY.originalSqlDigests.base ||
    p.originalSqlDigests?.addendum !==
      SNAPSHOT_TXN_BOUNDARY.originalSqlDigests.addendum ||
    !Array.isArray(p.statementIds) ||
    p.statementIds.length !== 11 ||
    p.statementIds.some((id, i) => id !== SINGLE_SNAPSHOT_IDS[i]) ||
    !Array.isArray(p.statementDigests) ||
    p.statementDigests.length !== 11 ||
    p.statementDigests.some(
      (digest, i) => digest !== m.statements[i].queryDigest
    ) ||
    !acceptableKeys(p, [
      'originalSqlDigests',
      'planDigest',
      'statementIds',
      'statementDigests'
    ])
  )
    e.push('EXACT_ELEVEN_PINNED_STATEMENTS_REQUIRED');
  const out = fixture.outputs;
  if (
    !record(out) ||
    out.mode !== 'SANITIZED_DIGESTS_ONLY' ||
    out.rawRowDataPresent !== false ||
    out.secretPresent !== false ||
    out.snapshotProof !== 'SYNTHETIC_NOT_REAL' ||
    !Array.isArray(out.unknownPrivilegedPaths) ||
    out.unknownPrivilegedPaths.length ||
    !acceptableKeys(out, [
      'mode',
      'rawRowDataPresent',
      'secretPresent',
      'snapshotProof',
      'unknownPrivilegedPaths'
    ])
  )
    e.push('UNSANITIZED_OR_UNKNOWN_PRIVILEGED_EVIDENCE_REJECTED');
  return verdict(e, 'EXECUTOR_BOUNDARY', {
    requiredSeparation: 'OWNER_GITHUB_CONTROL_DB_STAGING_DB_ARCHIVE'
  });
}

const commitment = (e) =>
  hash(
    JSON.stringify([
      e.runId,
      e.mainSha,
      e.headSha,
      e.commentId,
      e.planDigest,
      e.controlEpoch,
      e.sessionId,
      e.transactionId,
      e.snapshotId,
      e.sections.map((s) => [
        s?.ordinal,
        s?.sectionId,
        s?.statementDigest,
        s?.resultDigest,
        s?.rowCount
      ])
    ])
  );
export function makeGoodEvidenceEnvelopeFixture() {
  const m = expectedManifest(),
    inner = makeGoodOfflineFixture();
  const envelope = {
    protocol: EVIDENCE_REVIEW_PROTOCOL,
    runId: 'fixture-run-one',
    trust: 'UNTRUSTED_SYNTHETIC',
    mainSha: inner.owner.request.mainSha,
    headSha: inner.owner.request.headSha,
    commentId: inner.owner.request.commentId,
    planDigest: m.planDigest,
    controlEpoch: 0,
    sessionId: 'fixture-one-session',
    transactionId: 'fixture-one-transaction',
    snapshotId: 'fixture-one-snapshot',
    stagingRef: STAGING_PROJECT,
    queryCount: 11,
    sections: m.statements.map((s, i) => ({
      ordinal: i + 1,
      sectionId: s.id,
      statementDigest: s.queryDigest,
      rowCount: 1,
      resultDigest: 'c'.repeat(64)
    })),
    rollbackAck: 'received',
    closeAck: 'received',
    unknownPrivilegedPaths: [],
    archiveMode: 'DIGESTS_ONLY_NO_ROWS',
    seal: ''
  };
  envelope.seal = commitment(envelope);
  return { envelope, mockTrace: inner };
}

export function reviewInertEvidenceEnvelope({ fixture } = {}) {
  const e = [],
    m = expectedManifest(),
    env = fixture?.envelope,
    trace = fixture?.mockTrace;
  if (
    !record(fixture) ||
    !record(env) ||
    env.protocol !== EVIDENCE_REVIEW_PROTOCOL
  )
    return verdict(['EVIDENCE_ENVELOPE_REQUIRED'], 'EVIDENCE_ENVELOPE', {
      acceptedSectionCount: 0
    });
  if (
    !acceptableKeys(fixture, ['envelope', 'mockTrace']) ||
    !acceptableKeys(env, [
      'protocol',
      'runId',
      'trust',
      'mainSha',
      'headSha',
      'commentId',
      'planDigest',
      'controlEpoch',
      'sessionId',
      'transactionId',
      'snapshotId',
      'stagingRef',
      'queryCount',
      'sections',
      'rollbackAck',
      'closeAck',
      'unknownPrivilegedPaths',
      'archiveMode',
      'seal'
    ])
  )
    e.push('UNEXPECTED_AUDIT_FIELDS_OR_RAW_PAYLOAD');
  if (
    env.trust !== 'UNTRUSTED_SYNTHETIC' ||
    env.archiveMode !== 'DIGESTS_ONLY_NO_ROWS'
  )
    e.push('MODEL_EVIDENCE_MUST_NOT_CLAIM_TRUSTED_ARCHIVE');
  if (
    !/^fixture-[a-z0-9-]+$/u.test(String(env.runId)) ||
    !hex(env.mainSha, 40) ||
    !hex(env.headSha, 40) ||
    !Number.isSafeInteger(env.commentId) ||
    env.commentId <= 0 ||
    env.planDigest !== m.planDigest ||
    !Number.isSafeInteger(env.controlEpoch) ||
    env.controlEpoch < 0 ||
    env.stagingRef !== STAGING_PROJECT
  )
    e.push('AUDIT_BINDING_MISSING_OR_STALE');
  for (const field of ['sessionId', 'transactionId', 'snapshotId']) {
    if (typeof env[field] !== 'string' || !env[field].startsWith('fixture-'))
      e.push('AUDIT_TRANSACTION_CONTEXT_INVALID');
  }
  if (
    env.queryCount !== 11 ||
    !Array.isArray(env.sections) ||
    env.sections.length !== 11
  )
    e.push('ELEVEN_ORDERED_AUDIT_SECTIONS_REQUIRED');
  if (Array.isArray(env.sections))
    for (let i = 0; i < env.sections.length; i++) {
      const s = env.sections[i],
        expected = m.statements[i];
      if (
        !acceptableKeys(s, [
          'ordinal',
          'sectionId',
          'statementDigest',
          'rowCount',
          'resultDigest'
        ]) ||
        s.ordinal !== i + 1 ||
        s.sectionId !== expected?.id ||
        s.statementDigest !== expected?.queryDigest ||
        !Number.isSafeInteger(s.rowCount) ||
        s.rowCount < 0 ||
        !hex(s.resultDigest, 64)
      )
        e.push('AUDIT_SECTION_INVALID_OR_UNSANITIZED');
    }
  if (env.rollbackAck !== 'received' || env.closeAck !== 'received')
    e.push('ROLLBACK_OR_CONNECTION_CLOSE_UNCERTAIN');
  if (
    !Array.isArray(env.unknownPrivilegedPaths) ||
    env.unknownPrivilegedPaths.length !== 0
  )
    e.push('UNKNOWN_PRIVILEGED_PATHS_PROHIBIT_REVIEW');
  if (
    !hex(env.seal, 64) ||
    !Array.isArray(env.sections) ||
    env.seal !== commitment(env)
  )
    e.push('AUDIT_COMMITMENT_MISMATCH_NOT_A_SIGNATURE');
  if (
    !record(trace) ||
    env.mainSha !== trace.owner?.request?.mainSha ||
    env.headSha !== trace.owner?.request?.headSha ||
    env.commentId !== trace.owner?.request?.commentId ||
    env.planDigest !== trace.planDigest ||
    env.controlEpoch !== trace.control?.expectedEpoch
  )
    e.push('ENVELOPE_NOT_BOUND_TO_MOCK_CONTROL_AND_OWNER');
  const mock = record(trace)
    ? replayOfflineElevenSelects({ fixture: trace })
    : null;
  if (!mock?.invariantPassInFixture || mock?.syntheticSelectCount !== 11)
    e.push('MOCK_TRACE_FAILED_OR_UNVERIFIED');
  if (Array.isArray(env.sections) && Array.isArray(trace?.events))
    for (let i = 0; i < 11; i++) {
      const sec = env.sections[i],
        event = trace.events[i + 2];
      if (
        !sec ||
        sec.sectionId !== event?.sectionId ||
        sec.statementDigest !== event?.statementDigest ||
        sec.resultDigest !== event?.resultDigest ||
        sec.rowCount !== event?.rowCount
      )
        e.push('AUDIT_TRACE_SECTION_EVIDENCE_MISMATCH');
      if (
        env.sessionId !== event?.sessionId ||
        env.transactionId !== event?.transactionId ||
        env.snapshotId !== event?.snapshotId
      )
        e.push('AUDIT_TRACE_SNAPSHOT_CONTEXT_MISMATCH');
    }
  if (
    env.rollbackAck !== trace?.events?.[13]?.rollbackAck ||
    env.closeAck !== trace?.events?.[14]?.closeAck
  )
    e.push('AUDIT_TRACE_CLEANUP_MISMATCH');
  return verdict(e, 'EVIDENCE_ENVELOPE', {
    acceptedSectionCount: e.length === 0 ? 11 : 0,
    auditSealIsSignature: false,
    auditDigestAuthorizesNothing: true
  });
}
export function resealSyntheticEnvelope(fixture) {
  // Model convenience only: not authorization. Recomputed digests are NOT signatures.
  const e = fixture?.envelope;
  return record(e) && Array.isArray(e.sections) ? commitment(e) : null;
}
export function makeGoodRecoveryFixture() {
  return {
    protocol: RECOVERY_REVIEW_PROTOCOL,
    kind: 'OFFLINE_ONLY',
    steps: [...RECOVERY_STEPS],
    failure: 'NONE',
    attempt: 1,
    reconnects: 0,
    autoRetry: false,
    ownerReused: false,
    controlCommitAck: 'received',
    rollbackAck: 'received',
    closeAck: 'received',
    archivedSanitizedOnly: true,
    unknownPrivilegedPaths: [],
    controlReadback: 'NOT_PERFORMED_IN_MODEL'
  };
}
export function reviewInertRecovery({ fixture } = {}) {
  const e = [];
  if (!record(fixture) || fixture.protocol !== RECOVERY_REVIEW_PROTOCOL)
    return verdict(['RECOVERY_PROTOCOL_REQUIRED'], 'RECOVERY', {
      authoritativeReadbackRequired: true
    });
  if (
    !acceptableKeys(fixture, [
      'protocol',
      'kind',
      'steps',
      'failure',
      'attempt',
      'reconnects',
      'autoRetry',
      'ownerReused',
      'controlCommitAck',
      'rollbackAck',
      'closeAck',
      'archivedSanitizedOnly',
      'unknownPrivilegedPaths',
      'controlReadback'
    ])
  )
    e.push('UNKNOWN_RECOVERY_FIELD');
  if (
    fixture.kind !== 'OFFLINE_ONLY' ||
    !Array.isArray(fixture.steps) ||
    fixture.steps.length !== RECOVERY_STEPS.length ||
    fixture.steps.some((s, i) => s !== RECOVERY_STEPS[i])
  )
    e.push('RECOVERY_STEP_ORDER_OR_RUNTIME_MODE_INVALID');
  if (
    fixture.attempt !== 1 ||
    fixture.reconnects !== 0 ||
    fixture.autoRetry !== false ||
    fixture.ownerReused !== false
  )
    e.push('RETRY_RECONNECT_OR_OWNER_REUSE_PROHIBITED');
  if (fixture.failure !== 'NONE') {
    e.push(
      RECOVERY_FAILURES.includes(fixture.failure)
        ? 'INJECTED_FAILURE_MUST_HOLD'
        : 'UNKNOWN_FAILURE_MUST_HOLD'
    );
  }
  if (fixture.controlCommitAck !== 'received')
    e.push('CONTROL_COMMIT_UNCERTAIN_NO_RETRY');
  if (fixture.rollbackAck !== 'received')
    e.push('ROLLBACK_UNCERTAIN_DISCARD_RESULTS');
  if (fixture.closeAck !== 'received')
    e.push('CLOSE_UNCERTAIN_DISCARD_RESULTS');
  if (
    fixture.archivedSanitizedOnly !== true ||
    !Array.isArray(fixture.unknownPrivilegedPaths) ||
    fixture.unknownPrivilegedPaths.length
  )
    e.push('ARCHIVE_UNSANITIZED_OR_PRIVILEGE_PATH_UNKNOWN');
  if (fixture.controlReadback !== 'NOT_PERFORMED_IN_MODEL')
    e.push('SELF_ASSERTED_AUTHORITATIVE_CONTROL_READBACK');
  return verdict(e, 'RECOVERY', {
    authoritativeReadbackRequired:
      fixture.controlCommitAck !== 'received' ||
      fixture.failure === 'CONTROL_COMMIT_UNKNOWN',
    mayResumeClaim: false,
    mayReleaseFence: false,
    mayReplayOperation: false
  });
}
