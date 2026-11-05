// NOVELIGHT βScout Point10x: STRICTLY OFFLINE protocol replay.
// No DB adapters, SQL execution, network calls, OWNER impersonation, or durable writes.
// Every outcome remains NO-GO for real staging/production, including a perfect fixture.
import {
  makeInertSnapshotManifest,
  reviewSnapshotOwnerClaimContract,
  reviewHypotheticalSpentTrace,
  newHypotheticalSpentState,
  REQUIRED_FAIL_CLOSED,
  SINGLE_SNAPSHOT_IDS,
  SNAPSHOT_PLAN_SCOPE,
  SNAPSHOT_TXN_BOUNDARY
} from './scout-point10x-single-snapshot-review.mjs';
import { OWNER_CONTROL_ISSUE } from './scout-point10x-catalog-readonly-review.mjs';
import { STAGING_PROJECT } from './scout-point10x-atomic-execution-contract.mjs';

export const MOCK_PROTOCOL = 'NOVELIGHT_POINT10X_OFFLINE_REPLAY_V1';
const rec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sha = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v);
const safeCount = (v) => Number.isSafeInteger(v) && v >= 0;
const unique = (v) => Object.freeze([...new Set(v)]);
const freeze = (v) => Object.freeze(v);
const BASE_BLOCKERS = freeze([
  ...REQUIRED_FAIL_CLOSED,
  'OFFLINE_EVENTS_ARE_NOT_AUTHENTICATED_POSTGRES_EVIDENCE',
  'SYNTHETIC_OWNER_AND_CAS_DO_NOT_GRANT_EXECUTION'
]);
const context = freeze({
  connectionId: 'fixture-one-connection',
  sessionId: 'fixture-one-session',
  transactionId: 'fixture-one-transaction',
  snapshotId: 'fixture-one-snapshot',
  dbRef: STAGING_PROJECT
});

function outcome(errors, evidence = {}) {
  const failures = unique(errors);
  const passed = failures.length === 0;
  return freeze({
    status: passed ? 'NO_GO_OFFLINE_MOCK_ONLY' : 'HOLD_OFFLINE_MOCK',
    decision: 'NO_GO',
    blockers: unique([...BASE_BLOCKERS, ...failures]),
    invariantPassInFixture: passed,
    syntheticSelectCount: passed ? 11 : 0,
    partialResultsDiscarded: !passed,
    ...evidence,
    sourceTrust: 'UNTRUSTED_OFFLINE_FIXTURE',
    realDatabaseConnections: 0,
    realSqlExecuted: false,
    actualCatalogCompared: false,
    authenticatedOwner: false,
    actualControlClaimed: false,
    actualSpentConsumed: false,
    singleRealSnapshotVerified: false,
    realPrivilegedWriterFenced: false,
    mayConnectDb: false,
    mayRunSql: false,
    mayWriteDb: false,
    mayClaimOwner: false,
    mayUseDocker: false,
    mayRunStaging: false,
    mayChangeProduction: false,
    mayMergeMain: false,
    mayDeploy: false,
    autoRetry: false,
    noRetryAfterUnknownCommit: true
  });
}

export function makeGoodOfflineFixture(manifest = makeInertSnapshotManifest()) {
  const request = freeze({
    scope: SNAPSHOT_PLAN_SCOPE,
    operation: 'read-catalog-11-same-snapshot',
    issueNumber: OWNER_CONTROL_ISSUE,
    stagingRef: STAGING_PROJECT,
    mainSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    planDigest: manifest.planDigest,
    originalSqlDigests: { ...SNAPSHOT_TXN_BOUNDARY.originalSqlDigests },
    commentId: 123456789
  });
  const events = [
    { ...context, action: 'MOCK_OPEN', ok: true },
    {
      ...context,
      action: 'MOCK_BEGIN',
      command: SNAPSHOT_TXN_BOUNDARY.transactionBegin,
      isolation: 'REPEATABLE READ',
      readOnly: true,
      ok: true
    },
    ...manifest.statements.map((statement, i) => ({
      ...context,
      action: 'MOCK_SELECT',
      order: i + 1,
      sectionId: statement.id,
      statementDigest: statement.queryDigest,
      status: 'ok',
      rowCount: 1,
      resultDigest: 'c'.repeat(64)
    })),
    { ...context, action: 'MOCK_ROLLBACK', rollbackAck: 'received' },
    { ...context, action: 'MOCK_CLOSE', closeAck: 'received' }
  ];
  return {
    protocol: MOCK_PROTOCOL,
    planDigest: manifest.planDigest,
    sourceSqlDigests: { ...SNAPSHOT_TXN_BOUNDARY.originalSqlDigests },
    owner: {
      kind: 'SYNTHETIC_NOT_APPROVED',
      request,
      expectedMainSha: request.mainSha,
      expectedHeadSha: request.headSha
    },
    control: {
      kind: 'IN_MEMORY_ONLY',
      state: newHypotheticalSpentState(),
      commentId: request.commentId,
      expectedVersion: 0,
      expectedEpoch: 0,
      commitAck: 'received'
    },
    transport: {
      kind: 'IN_MEMORY_REPLAY',
      attempt: 1,
      reconnects: 0,
      autoRetry: false
    },
    privileges: {
      evidenceKind: 'SYNTHETIC_ONLY',
      coveredSections: [...SINGLE_SNAPSHOT_IDS],
      unknownPaths: [],
      schemaValid: true,
      digestsValid: true
    },
    events
  };
}

// This is an offline parser of preconstructed mock events, NOT a database runner.
// Do not accept executable drivers/callbacks or actual SQL text as inputs.
export function replayOfflineElevenSelects({
  fixture,
  manifest = makeInertSnapshotManifest()
} = {}) {
  const errors = [];
  const canonical = makeInertSnapshotManifest();
  if (
    !rec(manifest) ||
    manifest.planDigest !== canonical.planDigest ||
    manifest.sectionCount !== 11 ||
    !Array.isArray(manifest.statements) ||
    manifest.statements.length !== 11 ||
    manifest.statements.some(
      (s, i) =>
        s?.id !== canonical.statements[i].id ||
        s?.queryDigest !== canonical.statements[i].queryDigest ||
        s?.containsOnlyOneTopLevelSelectUnderExactSourcePin !== true
    ) ||
    canonical.sourceBytesChanged ||
    canonical.statements.some(
      (s) => !s.containsOnlyOneTopLevelSelectUnderExactSourcePin
    )
  )
    errors.push('PINNED_MANIFEST_NOT_CANONICAL');

  if (!rec(fixture) || fixture.protocol !== MOCK_PROTOCOL)
    return outcome([...errors, 'MOCK_PROTOCOL_REQUIRED']);

  if (
    fixture.planDigest !== canonical.planDigest ||
    fixture.sourceSqlDigests?.base !==
      SNAPSHOT_TXN_BOUNDARY.originalSqlDigests.base ||
    fixture.sourceSqlDigests?.addendum !==
      SNAPSHOT_TXN_BOUNDARY.originalSqlDigests.addendum
  )
    errors.push('SOURCE_OR_PLAN_DIGEST_MISMATCH');

  const o = fixture.owner;
  if (!rec(o) || o.kind !== 'SYNTHETIC_NOT_APPROVED' || !rec(o.request))
    errors.push('SYNTHETIC_OWNER_RECORD_REQUIRED');
  else {
    const reviewed = reviewSnapshotOwnerClaimContract({
      request: o.request,
      manifest: canonical
    });
    if (reviewed.blockers.length !== REQUIRED_FAIL_CLOSED.length)
      errors.push('OWNER_SCOPE_OR_REQUEST_CONTRACT_MISMATCH');
    if (
      o.request.mainSha !== o.expectedMainSha ||
      o.request.headSha !== o.expectedHeadSha
    )
      errors.push('STALE_OWNER_MAIN_OR_HEAD_BINDING');
    if (
      o.authenticated === true ||
      o.approved === true ||
      o.request.approved === true
    )
      errors.push('CALLER_ASSERTED_OWNER_AUTHORITY');
  }

  const control = fixture.control;
  if (!rec(control) || control.kind !== 'IN_MEMORY_ONLY')
    errors.push('CONTROL_FIXTURE_REQUIRED');
  else {
    const model = reviewHypotheticalSpentTrace({
      state: control.state,
      commentId: control.commentId,
      expectedVersion: control.expectedVersion,
      expectedEpoch: control.expectedEpoch,
      commitAck: control.commitAck
    });
    if (control.commentId !== o?.request?.commentId)
      errors.push('OWNER_CONTROL_COMMENT_ID_MISMATCH');
    if (model.status === 'HOLD_MODEL_LOST_COMMIT_ACK')
      errors.push('CONTROL_COMMIT_ACK_UNKNOWN_NO_RETRY');
    else if (model.status !== 'MODEL_SPENT_NOT_REAL')
      errors.push('CONTROL_CAS_CONFLICT_OR_STALE_EPOCH');
    if (
      control.claimed === true ||
      control.consumed === true ||
      control.durable === true
    )
      errors.push('INERT_CONTROL_CANNOT_CLAIM_DURABILITY');
  }

  const t = fixture.transport;
  if (
    !rec(t) ||
    t.kind !== 'IN_MEMORY_REPLAY' ||
    t.attempt !== 1 ||
    t.reconnects !== 0 ||
    t.autoRetry !== false
  )
    errors.push('SECOND_ATTEMPT_RECONNECT_OR_REAL_TRANSPORT_FORBIDDEN');

  const p = fixture.privileges;
  if (
    !rec(p) ||
    p.evidenceKind !== 'SYNTHETIC_ONLY' ||
    p.schemaValid !== true ||
    p.digestsValid !== true ||
    !Array.isArray(p.coveredSections) ||
    p.coveredSections.length !== 11 ||
    p.coveredSections.some((id, i) => id !== SINGLE_SNAPSHOT_IDS[i]) ||
    !Array.isArray(p.unknownPaths) ||
    p.unknownPaths.length !== 0
  )
    errors.push('PRIVILEGED_PATH_COVERAGE_UNKNOWN_OR_INVALID');

  const events = fixture.events;
  if (!Array.isArray(events) || events.length !== 15)
    errors.push('ONE_OPEN_BEGIN_ELEVEN_SELECTS_ROLLBACK_CLOSE_REQUIRED');
  const e = Array.isArray(events) ? events : [];
  const open = e[0],
    begin = e[1],
    rollback = e[13],
    close = e[14];
  if (
    open?.action !== 'MOCK_OPEN' ||
    open?.ok !== true ||
    begin?.action !== 'MOCK_BEGIN' ||
    begin?.ok !== true ||
    rollback?.action !== 'MOCK_ROLLBACK' ||
    close?.action !== 'MOCK_CLOSE'
  )
    errors.push('MOCK_LIFECYCLE_ORDER_INVALID');
  if (
    begin?.command !== SNAPSHOT_TXN_BOUNDARY.transactionBegin ||
    begin?.readOnly !== true ||
    begin?.isolation !== 'REPEATABLE READ'
  )
    errors.push('READ_ONLY_REPEATABLE_READ_NOT_ENFORCED');
  if (rollback?.rollbackAck !== 'received')
    errors.push('ROLLBACK_UNCERTAIN_DISCARD_ALL');
  if (close?.closeAck !== 'received')
    errors.push('CONNECTION_CLOSE_UNCERTAIN_DISCARD_ALL');
  for (const event of e) {
    if (!rec(event)) {
      errors.push('MALFORMED_MOCK_EVENT');
      continue;
    }
    if (event.dbRef !== STAGING_PROJECT)
      errors.push('STAGING_TARGET_INCORRECT');
    for (const key of [
      'connectionId',
      'sessionId',
      'transactionId',
      'snapshotId'
    ]) {
      if (
        event[key] !== context[key] ||
        typeof event[key] !== 'string' ||
        !event[key].startsWith('fixture-')
      )
        errors.push('CROSS_CONNECTION_SESSION_TRANSACTION_OR_SNAPSHOT');
    }
    if (
      [
        'COMMIT',
        'SELECT',
        'UPDATE',
        'DELETE',
        'INSERT',
        'DDL',
        'DML',
        'RECONNECT'
      ].includes(event.action)
    )
      errors.push('REAL_SQL_COMMIT_OR_RECONNECT_ACTION_FORBIDDEN');
  }
  for (let i = 0; i < 11; i++) {
    const step = e[i + 2],
      expected = canonical.statements[i];
    if (
      step?.action !== 'MOCK_SELECT' ||
      step?.order !== i + 1 ||
      step?.sectionId !== expected.id ||
      step?.statementDigest !== expected.queryDigest
    )
      errors.push('SELECT_ORDER_COUNT_OR_STATEMENT_DIGEST_INVALID');
    if (
      step?.status !== 'ok' ||
      !safeCount(step.rowCount) ||
      !sha(step.resultDigest)
    )
      errors.push('SELECT_FAILURE_TIMEOUT_OR_MALFORMED_RESULT');
    if (step?.resultPayload !== undefined || step?.sql !== undefined)
      errors.push('UNSANITIZED_SQL_OR_RESULT_PAYLOAD_FORBIDDEN');
  }
  return outcome(errors, {
    canonicalManifestDigest: canonical.planDigest,
    onePhysicalConnectionInFixture: errors.every(
      (code) =>
        code !== 'CROSS_CONNECTION_SESSION_TRANSACTION_OR_SNAPSHOT' &&
        code !== 'ONE_OPEN_BEGIN_ELEVEN_SELECTS_ROLLBACK_CLOSE_REQUIRED'
    ),
    rollbackAcknowledgedInFixture: rollback?.rollbackAck === 'received'
  });
}
